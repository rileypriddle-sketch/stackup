"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { connect, disconnect, openContractCall, request } from "@stacks/connect";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import {
  cvToValue,
  fetchCallReadOnlyFunction,
  listCV,
  principalCV,
  type ClarityValue,
  stringAsciiCV,
  uintCV,
} from "@stacks/transactions";
import styles from "./page.module.css";

const APP_NAME = "StackUp";
const APP_ICON_PATH = "/icons/icon.png";

const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  "SP2022VXQ3E384AAHQ15KFFXVN3CY5G57HWCCQX23";
const CONTRACT_NAME = process.env.NEXT_PUBLIC_CONTRACT_NAME ?? "streak-v3-5";
const STACKS_NETWORK = (process.env.NEXT_PUBLIC_STACKS_NETWORK ??
  "mainnet") as "mainnet" | "testnet";

const WALLET_NETWORK = STACKS_NETWORK;
const ADDRESS_PREFIX = STACKS_NETWORK === "mainnet" ? "SP" : "ST";
const STACKS_NETWORK_OBJ =
  STACKS_NETWORK === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;

const BADGE_MILESTONES = [
  { kind: 1, label: "1 day" },
  { kind: 3, label: "3 day" },
  { kind: 7, label: "7 day" },
  { kind: 14, label: "14 day" },
  { kind: 30, label: "30 day" },
] as const;

const BADGE_ASSETS: Record<number, string> = {
  1: "/badges/1-day-streak.png",
  3: "/badges/3-day-streak.png",
  7: "/badges/7-day-streak.png",
  14: "/badges/14-day-streak.png",
  30: "/badges/30-day-streak.png",
};

export default function ClientPage() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [status, setStatus] = useState<string>("Not connected");
  const [error, setError] = useState<string>("");
  const [streak, setStreak] = useState<number | null>(null);
  const [lastClaimDay, setLastClaimDay] = useState<number | null>(null);
  const [hasBadge, setHasBadge] = useState<boolean | null>(null);
  const [badgeSupport, setBadgeSupport] = useState<"v1" | "v2" | null>(null);
  const [badgeStatus, setBadgeStatus] = useState<Record<number, boolean>>({});
  const [badgeTokenIds, setBadgeTokenIds] = useState<
    Record<number, number | null>
  >({});
  const [milestones, setMilestones] = useState<number[] | null>(null);
  const [adminOpen, setAdminOpen] = useState<boolean>(false);
  const [adminUnlocked, setAdminUnlocked] = useState<boolean>(false);
  const [adminTapCount, setAdminTapCount] = useState<number>(0);
  const [adminTapTs, setAdminTapTs] = useState<number>(0);
  const [contractOwner, setContractOwner] = useState<string | null>(null);
  const [adminMilestones, setAdminMilestones] = useState<string>("1,3,7,14,30");
  const [adminMintFee, setAdminMintFee] = useState<string>("0");
  const [adminFeeRecipient, setAdminFeeRecipient] = useState<string>("");
  const [adminBadgeKind, setAdminBadgeKind] = useState<string>("1");
  const [adminBadgeUri, setAdminBadgeUri] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const storedAddress = localStorage.getItem("stackup_wallet_address");
    if (storedAddress) {
      setWalletAddress(storedAddress);
      setStatus("Wallet connected");
    }
  }, []);

  useEffect(() => {
    if (walletAddress) {
      localStorage.setItem("stackup_wallet_address", walletAddress);
    } else {
      localStorage.removeItem("stackup_wallet_address");
    }
  }, [walletAddress]);

  const address = walletAddress;
  const isOwner =
    Boolean(address) && Boolean(contractOwner) && address === contractOwner;
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "Not connected";

  const stacksApiBase =
    STACKS_NETWORK === "mainnet"
      ? "https://api.mainnet.hiro.so"
      : "https://api.testnet.hiro.so";

  const fetchContractOwner = useCallback(async () => {
    // Pull `contract-owner` data-var via Stacks API since it's not exposed as a read-only.
    try {
      const res = await fetch(
        `${stacksApiBase}/v2/data_var/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/contract-owner`
      );
      if (!res.ok) return;
      const body = (await res.json()) as unknown;

      const repr =
        typeof body === "object" && body !== null && "repr" in body
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (body as any).repr
          : null;
      const data =
        typeof body === "object" && body !== null && "data" in body
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (body as any).data
          : null;

      const candidateText =
        typeof repr === "string"
          ? repr
          : typeof data === "string"
          ? data
          : "";

      const match = candidateText.match(/(SP|ST)[A-Z0-9]{20,}/);
      if (match?.[0]) {
        setContractOwner(match[0]);
      }
    } catch {
      // ignore
    }
  }, [stacksApiBase]);

  const connectWallet = async () => {
    setError("");
    setStatus("Opening wallet...");
    try {
      const result = await connect({ network: WALLET_NETWORK });
      let nextAddress =
        result.addresses?.find((entry) => entry.address.startsWith(ADDRESS_PREFIX))
          ?.address ?? "";
      if (!nextAddress) {
        const rpcResult = await request("stx_getAddresses", {
          network: WALLET_NETWORK,
        });
        nextAddress =
          rpcResult.addresses?.find((entry) => entry.address.startsWith(ADDRESS_PREFIX))
            ?.address ?? "";
      }
      setWalletAddress(nextAddress);
      if (nextAddress) {
        setStatus("Wallet connected");
        fetchOnChain(nextAddress);
      } else {
        setStatus("Connected");
        setError(
          "No STX address found. Make sure Leather is unlocked and on mainnet."
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Wallet connect failed.";
      setError(message);
      setStatus("Not connected");
    }
  };

  useEffect(() => {
    fetchContractOwner();
  }, [fetchContractOwner]);

  const disconnectWallet = async () => {
    disconnect();
    setWalletAddress("");
    setStatus("Not connected");
  };

  const fetchOnChain = useCallback(async (senderOverride?: string) => {
    if (
      !(
        CONTRACT_ADDRESS.startsWith("ST") ||
        CONTRACT_ADDRESS.startsWith("SP")
      )
    ) {
      setError(
        "Set a valid contract address before fetching on-chain data (ST... or SP...)."
      );
      return;
    }

    setIsLoading(true);
    setError("");

    const sender = senderOverride || address || CONTRACT_ADDRESS;

    try {
      const [streakCV, lastDayCV] = await Promise.all([
        fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "get-streak",
          functionArgs: [principalCV(sender)],
          network: STACKS_NETWORK_OBJ,
          senderAddress: sender,
        }),
        fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "get-last-claim-day",
          functionArgs: [principalCV(sender)],
          network: STACKS_NETWORK_OBJ,
          senderAddress: sender,
        }),
      ]);

      const streakValue = cvToValue(streakCV) as unknown;
      const lastDayValue = cvToValue(lastDayCV) as unknown;
      setStreak(
        typeof streakValue === "bigint"
          ? Number(streakValue)
          : (streakValue as number)
      );
      setLastClaimDay(
        typeof lastDayValue === "bigint"
          ? Number(lastDayValue)
          : (lastDayValue as number)
      );

      const loadV2Badges = async () => {
        const kindsToCheck = Array.from(new Set(BADGE_MILESTONES.map((m) => m.kind)));

        const badgeChecks = await Promise.all(
          kindsToCheck.map(async (kind) => {
            const [hasCV, tokenCV] = await Promise.all([
              fetchCallReadOnlyFunction({
                contractAddress: CONTRACT_ADDRESS,
                contractName: CONTRACT_NAME,
                functionName: "has-badge-kind",
                functionArgs: [principalCV(sender), uintCV(kind)],
                network: STACKS_NETWORK_OBJ,
                senderAddress: sender,
              }),
              fetchCallReadOnlyFunction({
                contractAddress: CONTRACT_ADDRESS,
                contractName: CONTRACT_NAME,
                functionName: "get-badge-token-id",
                functionArgs: [principalCV(sender), uintCV(kind)],
                network: STACKS_NETWORK_OBJ,
                senderAddress: sender,
              }),
            ]);
            return {
              kind,
              has: Boolean(cvToValue(hasCV)),
              token: cvToValue(tokenCV) as unknown,
            };
          })
        );

        const nextStatus: Record<number, boolean> = {};
        const nextTokenIds: Record<number, number | null> = {};
        for (const entry of badgeChecks) {
          nextStatus[entry.kind] = entry.has;
          if (entry.token === null) {
            nextTokenIds[entry.kind] = null;
          } else if (typeof entry.token === "bigint") {
            nextTokenIds[entry.kind] = Number(entry.token);
          } else if (typeof entry.token === "number") {
            nextTokenIds[entry.kind] = entry.token;
          } else {
            nextTokenIds[entry.kind] = null;
          }
        }

        setBadgeSupport("v2");
        setBadgeStatus(nextStatus);
        setBadgeTokenIds(nextTokenIds);
        setHasBadge(Boolean(nextStatus[7]));
      };

      try {
        await loadV2Badges();
      } catch {
        const badgeCV = await fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "has-badge",
          functionArgs: [principalCV(sender)],
          network: STACKS_NETWORK_OBJ,
          senderAddress: sender,
        });
        const badgeValue = cvToValue(badgeCV) as unknown;
        setBadgeSupport("v1");
        setHasBadge(Boolean(badgeValue));
        setBadgeStatus({ 7: Boolean(badgeValue) });
        setBadgeTokenIds({});
      }

      try {
        const senderAddress = sender;
        const milestonesCV = await fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "get-milestones",
          functionArgs: [],
          network: STACKS_NETWORK_OBJ,
          senderAddress,
        });

        const ms = cvToValue(milestonesCV) as unknown;

        if (Array.isArray(ms)) {
          const parsed = ms
            .map((v) => (typeof v === "bigint" ? Number(v) : Number(v)))
            .filter((v) => Number.isFinite(v) && v > 0);
          setMilestones(parsed);
          setAdminMilestones(parsed.join(","));
        } else {
          setMilestones(null);
        }

      } catch {
        // Older contracts might not expose these admin read-only endpoints.
        setMilestones(null);
      }

      setStatus("On-chain data refreshed");
    } catch {
      setError("Failed to fetch on-chain data.");
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  const scheduleRefresh = useCallback(
    (senderOverride?: string) => {
      // Most transactions won't reflect immediately; refresh a couple times.
      setTimeout(() => fetchOnChain(senderOverride), 6_000);
      setTimeout(() => fetchOnChain(senderOverride), 18_000);
    },
    [fetchOnChain]
  );

  const openTx = (opts: { functionName: string; functionArgs: ClarityValue[] }) => {
    openContractCall({
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME,
      functionName: opts.functionName,
      functionArgs: opts.functionArgs,
      network: STACKS_NETWORK_OBJ,
      appDetails: {
        name: APP_NAME,
        icon: new URL(APP_ICON_PATH, window.location.origin).toString(),
      },
      onFinish: () => {
        setStatus("Transaction submitted");
        scheduleRefresh(address || undefined);
      },
      onCancel: () => {
        setStatus("Transaction cancelled");
      },
    });
  };

  const parseMilestonesInput = (value: string) => {
    const parts = value
      .split(/[,\s]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
    const nums = parts
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && Number.isInteger(v) && v > 0);
    const unique = Array.from(new Set(nums)).slice(0, 20);
    unique.sort((a, b) => a - b);
    return unique;
  };

  const setMilestonesTx = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    const parsed = parseMilestonesInput(adminMilestones);
    if (parsed.length === 0) {
      setError("Enter at least one milestone (e.g. 1,3,7).");
      return;
    }

    setError("");
    setStatus("Setting milestones...");
    try {
      openContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "set-milestones",
        functionArgs: [listCV(parsed.map((n) => uintCV(n)))],
        network: STACKS_NETWORK_OBJ,
        appDetails: {
          name: APP_NAME,
          icon: new URL(APP_ICON_PATH, window.location.origin).toString(),
        },
        onFinish: () => {
          setStatus("Milestones submitted");
          scheduleRefresh(address);
        },
        onCancel: () => setStatus("Milestones cancelled"),
      });
    } catch {
      setError("Failed to open milestones transaction.");
      setStatus("Milestones failed");
    }
  };

  const setMintFeeTx = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    const fee = Number(adminMintFee);
    if (!Number.isFinite(fee) || !Number.isInteger(fee) || fee < 0) {
      setError("Enter a valid fee in uSTX (e.g. 0 or 1000000).");
      return;
    }

    setError("");
    setStatus("Setting mint fee...");
    try {
      openTx({ functionName: "set-mint-fee", functionArgs: [uintCV(fee)] });
    } catch {
      setError("Failed to open fee transaction.");
      setStatus("Fee update failed");
    }
  };

  const setFeeRecipientTx = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!adminFeeRecipient) {
      setError("Enter a fee-recipient address (SP... or ST...).");
      return;
    }
    setError("");
    setStatus("Setting fee-recipient...");
    try {
      openContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "set-fee-recipient",
        functionArgs: [principalCV(adminFeeRecipient)],
        network: STACKS_NETWORK_OBJ,
        appDetails: {
          name: APP_NAME,
          icon: new URL(APP_ICON_PATH, window.location.origin).toString(),
        },
        onFinish: () => {
          setStatus("Fee-recipient submitted");
          scheduleRefresh(address);
        },
        onCancel: () => setStatus("Fee-recipient cancelled"),
      });
    } catch {
      setError("Failed to open fee-recipient transaction.");
      setStatus("Fee-recipient failed");
    }
  };

  const setBadgeUriTx = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    const kind = Number(adminBadgeKind);
    const uri = adminBadgeUri.trim();
    if (!Number.isFinite(kind) || !Number.isInteger(kind) || kind <= 0) {
      setError("Enter a valid kind (e.g. 7).");
      return;
    }
    if (!uri) {
      setError("Enter a metadata URI (e.g. ipfs://...).");
      return;
    }
    if (uri.length > 256) {
      setError("URI must be <= 256 characters.");
      return;
    }

    setError("");
    setStatus("Setting badge URI...");
    try {
      openContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "set-badge-uri",
        functionArgs: [uintCV(kind), stringAsciiCV(uri)],
        network: STACKS_NETWORK_OBJ,
        appDetails: {
          name: APP_NAME,
          icon: new URL(APP_ICON_PATH, window.location.origin).toString(),
        },
        onFinish: () => {
          setStatus("Badge URI submitted");
          scheduleRefresh(address);
        },
        onCancel: () => setStatus("Badge URI cancelled"),
      });
    } catch {
      setError("Failed to open badge URI transaction.");
      setStatus("Badge URI failed");
    }
  };

  useEffect(() => {
    if (address) {
      fetchOnChain();
    }
  }, [address, fetchOnChain]);

  const claimStreak = async () => {
    setError("");
    setStatus("Submitting claim...");

    try {
      openContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "claim",
        functionArgs: [],
        network: STACKS_NETWORK_OBJ,
        appDetails: {
          name: APP_NAME,
          icon: new URL(APP_ICON_PATH, window.location.origin).toString(),
        },
        onFinish: () => {
          setStatus("Claim submitted");
          scheduleRefresh(address || undefined);
        },
        onCancel: () => {
          setStatus("Claim cancelled");
        },
      });
    } catch {
      setError("Failed to open contract call.");
      setStatus("Claim failed");
    }
  };

  const mintBadgeKind = async (kind: number) => {
    setError("");
    setStatus(`Minting ${kind}-day badge...`);

    try {
      openContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "mint-badge-kind",
        functionArgs: [uintCV(kind)],
        network: STACKS_NETWORK_OBJ,
        appDetails: {
          name: APP_NAME,
          icon: new URL(APP_ICON_PATH, window.location.origin).toString(),
        },
        onFinish: () => {
          setStatus("Mint submitted");
          scheduleRefresh(address || undefined);
        },
        onCancel: () => {
          setStatus("Mint cancelled");
        },
      });
    } catch {
      setError("Failed to open mint transaction.");
      setStatus("Mint failed");
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image
              className={styles.logo}
              src={theme === "dark" ? "/logo/logo-dark.png" : "/logo/logo-light.png"}
              alt="StackUp logo"
              width={400}
              height={140}
              sizes="(max-width: 720px) 160px, 200px"
              priority
              style={{ height: "auto" }}
              onClick={() => {
                const now = Date.now();
                const withinWindow = adminTapTs && now - adminTapTs < 2500;
                const nextCount = withinWindow ? adminTapCount + 1 : 1;

                setAdminTapTs(now);
                setAdminTapCount(nextCount);

                if (nextCount >= 7) {
                  setAdminUnlocked(true);
                  setAdminOpen(true);
                  setAdminTapCount(0);
                }
              }}
            />
            <div className={styles.brandText}>Daily streaks on Stacks.</div>
          </div>
          <div className={styles.actions}>
            <button
              className={`${styles.button} ${styles.ghostButton}`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </button>
            {address ? (
              <>
                <button
                  className={`${styles.button} ${styles.ghostButton} ${styles.walletButton}`}
                  onClick={() => fetchOnChain()}
                  type="button"
                >
                  <span className={styles.walletMain}>{shortAddress}</span>
                  <span className={styles.walletSub}>
                    Streak {streak ?? "-"} {" | "}Day {lastClaimDay ?? "-"}
                  </span>
                </button>
                <button
                  className={`${styles.button} ${styles.ghostButton}`}
                  onClick={disconnectWallet}
                  type="button"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button className={styles.button} onClick={connectWallet}>
                Connect Wallet
              </button>
            )}
          </div>
        </header>

        <section className={styles.hero}>
          <div>
            <div className={styles.headline}>
              Build the streak.
              <span> Claim daily.</span>
            </div>
            <p className={styles.lede}>
              StackUp tracks your daily claim on Stacks {STACKS_NETWORK}. Claim
              once per day to build momentum and unlock NFT badges.
            </p>
            <div className={styles.heroMeta}>
              <div className={styles.metaItem}>
                Contract <code>{CONTRACT_ADDRESS}.{CONTRACT_NAME}</code>
              </div>
              <div className={styles.metaItem}>
                Network{" "}
                <code>{STACKS_NETWORK === "mainnet" ? "Mainnet" : "Testnet"}</code>
              </div>
            </div>
            <div className={styles.heroActions}>
              <button className={styles.button} onClick={claimStreak}>
                Claim Now
              </button>
              <button
                className={`${styles.button} ${styles.ghostButton}`}
                onClick={() => fetchOnChain()}
                disabled={isLoading}
              >
                {isLoading ? "Refreshing..." : "Refresh On-Chain"}
              </button>
            </div>
            <div className={styles.statusLine}>
              Status: <span>{status}</span>
            </div>
            {error ? <div className={styles.danger}>{error}</div> : null}
          </div>
        </section>

        <section className={styles.panelGrid}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Badge milestone</h2>
              <span className={styles.pill}>NFT</span>
            </div>
            <div className={styles.stack}>
              <div className={styles.badgeGrid}>
                {BADGE_MILESTONES.map((milestone) => {
                  const earned =
                    badgeStatus[milestone.kind] ??
                    (milestone.kind === 7 ? hasBadge ?? false : false);
                  const tokenId = badgeTokenIds[milestone.kind];

                  const canMint =
                    badgeSupport === "v2" &&
                    Boolean(address) &&
                    typeof streak === "number" &&
                    streak >= milestone.kind &&
                    !earned;

                  return (
                    <div key={milestone.kind} className={styles.badgeCard}>
                      <div className={styles.badgeThumb}>
                        <Image
                          src={BADGE_ASSETS[milestone.kind]}
                          alt={`${milestone.kind} day streak badge`}
                          width={92}
                          height={92}
                          style={{ height: "auto" }}
                        />
                      </div>
                      <div className={styles.badgeMeta}>
                        <div className={styles.badgeTitle}>
                          <strong>{milestone.kind}</strong> day badge
                        </div>
                        <div className={styles.badgeLine}>
                          Status:{" "}
                          <span
                            className={
                              hasBadge === null && badgeSupport === null
                                ? ""
                                : earned
                                ? styles.success
                                : styles.warn
                            }
                          >
                            {hasBadge === null && badgeSupport === null
                              ? "Not loaded"
                              : earned
                              ? "Claimed"
                              : "Not claimed"}
                          </span>
                        </div>
                        {earned && tokenId !== undefined && tokenId !== null ? (
                          <div className={styles.badgeLine}>
                            Token: <code>{tokenId}</code>
                          </div>
                        ) : null}
                        {canMint ? (
                          <button
                            className={`${styles.button} ${styles.ghostButton}`}
                            onClick={() => mintBadgeKind(milestone.kind)}
                          >
                            Mint Badge
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.footnote}>
                Badges are minted by the on-chain <code>claim</code> function.
                {badgeSupport === "v1"
                  ? " This contract supports the 7-day badge."
                  : badgeSupport === "v2"
                  ? " This contract supports multiple milestones. New milestones are enabled by setting a token URI, and users can mint them any time after reaching the streak."
                  : ""}
              </div>
            </div>
          </div>
        </section>

        {adminUnlocked && adminOpen ? (
          <div
            className={styles.modalBackdrop}
            onClick={() => {
              setAdminOpen(false);
              setAdminUnlocked(false);
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <div className={styles.modalTitle}>Admin</div>
                  <div className={styles.modalSub}>
                    Owner-only controls. Tap the logo 7 times to open this panel.
                  </div>
                </div>
                <button
                  className={`${styles.button} ${styles.ghostButton}`}
                  onClick={() => {
                    setAdminOpen(false);
                    setAdminUnlocked(false);
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>

              {!address ? (
                <div className={styles.danger}>
                  Connect your wallet to access admin controls.
                </div>
              ) : !contractOwner ? (
                <div className={styles.field}>
                  Contract owner
                  <code>Loading...</code>
                </div>
              ) : !isOwner ? (
                <div className={styles.danger}>
                  This wallet is not the contract owner.
                  <div className={styles.footnote}>
                    Connected: <code>{address}</code>
                    {" | "}Owner: <code>{contractOwner}</code>
                  </div>
                </div>
              ) : (
                <div className={styles.adminPanel}>
                  <div className={styles.adminSection}>
                    <div className={styles.adminTitle}>Milestones (Auto-Mint)</div>
                    <div className={styles.adminRow}>
                      <input
                        className={styles.input}
                        placeholder="e.g. 1,3,7,14,30,60"
                        value={adminMilestones}
                        onChange={(e) => setAdminMilestones(e.target.value)}
                      />
                      <button
                        className={styles.button}
                        onClick={setMilestonesTx}
                        disabled={!address}
                      >
                        Set
                      </button>
                    </div>
                    <div className={styles.footnote}>
                      Current:{" "}
                      <code>
                        {milestones === null ? "Not loaded" : milestones.join(",")}
                      </code>
                    </div>
                  </div>

                  <div className={styles.adminSection}>
                    <div className={styles.adminTitle}>Fee Settings</div>
                    <div className={styles.adminRow}>
                      <input
                        className={styles.input}
                        inputMode="numeric"
                        placeholder="mint fee (uSTX)"
                        value={adminMintFee}
                        onChange={(e) => setAdminMintFee(e.target.value)}
                      />
                      <button
                        className={styles.button}
                        onClick={setMintFeeTx}
                        disabled={!address}
                      >
                        Set Fee
                      </button>
                    </div>
                    <div className={styles.adminRow}>
                      <input
                        className={styles.input}
                        placeholder="fee recipient (SP.../ST...)"
                        value={adminFeeRecipient}
                        onChange={(e) => setAdminFeeRecipient(e.target.value)}
                      />
                      <button
                        className={styles.button}
                        onClick={setFeeRecipientTx}
                        disabled={!address}
                      >
                        Set Recipient
                      </button>
                    </div>
                  </div>

                  <div className={styles.adminSection}>
                    <div className={styles.adminTitle}>Badge Metadata URI</div>
                    <div className={styles.adminRow}>
                      <input
                        className={styles.input}
                        inputMode="numeric"
                        placeholder="kind (e.g. 7)"
                        value={adminBadgeKind}
                        onChange={(e) => setAdminBadgeKind(e.target.value)}
                      />
                      <input
                        className={styles.input}
                        placeholder="ipfs://<metadataCID>"
                        value={adminBadgeUri}
                        onChange={(e) => setAdminBadgeUri(e.target.value)}
                      />
                      <button
                        className={styles.button}
                        onClick={setBadgeUriTx}
                        disabled={!address}
                      >
                        Set URI
                      </button>
                    </div>
                    <div className={styles.footnote}>
                      Owner-only. If you aren{"'"}t the contract owner, these calls will
                      fail on-chain.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
