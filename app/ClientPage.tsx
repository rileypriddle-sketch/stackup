"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { connect, disconnect, openContractCall, request } from "@stacks/connect";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import {
  cvToValue,
  fetchCallReadOnlyFunction,
  principalCV,
  uintCV,
} from "@stacks/transactions";
import styles from "./page.module.css";

const APP_NAME = "StackUp";
const APP_ICON_PATH = "/icons/icon.png";

const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  "SP2022VXQ3E384AAHQ15KFFXVN3CY5G57HWCCQX23";
const CONTRACT_NAME = process.env.NEXT_PUBLIC_CONTRACT_NAME ?? "streak";
const STACKS_NETWORK = (process.env.NEXT_PUBLIC_STACKS_NETWORK ??
  "mainnet") as "mainnet" | "testnet";

const WALLET_NETWORK = STACKS_NETWORK;
const ADDRESS_PREFIX = STACKS_NETWORK === "mainnet" ? "SP" : "ST";
const STACKS_NETWORK_OBJ =
  STACKS_NETWORK === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;

const BADGE_MILESTONES = [
  { kind: 3, label: "3 day" },
  { kind: 7, label: "7 day" },
  { kind: 14, label: "14 day" },
  { kind: 30, label: "30 day" },
] as const;

const BADGE_ASSETS: Record<number, string> = {
  3: "/badges/3-day-streak.png",
  7: "/badges/7-day-streak.png",
  14: "/badges/14-day-streak.png",
  30: "/badges/30-day-streak.png",
};

export default function ClientPage() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [status, setStatus] = useState<string>("Not connected");
  const [error, setError] = useState<string>("");
  const [lastTxId, setLastTxId] = useState<string>("");
  const [streak, setStreak] = useState<number | null>(null);
  const [lastClaimDay, setLastClaimDay] = useState<number | null>(null);
  const [hasBadge, setHasBadge] = useState<boolean | null>(null);
  const [badgeSupport, setBadgeSupport] = useState<"v1" | "v2" | null>(null);
  const [badgeStatus, setBadgeStatus] = useState<Record<number, boolean>>({});
  const [badgeTokenIds, setBadgeTokenIds] = useState<
    Record<number, number | null>
  >({});
  const [badgeUris, setBadgeUris] = useState<Record<number, string | null>>({});
  const [customKind, setCustomKind] = useState<string>("");
  const [customHas, setCustomHas] = useState<boolean | null>(null);
  const [customTokenId, setCustomTokenId] = useState<number | null>(null);
  const [customUri, setCustomUri] = useState<string | null>(null);
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
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "Not connected";

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

  const disconnectWallet = async () => {
    disconnect();
    setWalletAddress("");
    setStatus("Not connected");
  };

  const fetchOnChain = useCallback(async () => {
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

    const sender = address || CONTRACT_ADDRESS;

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
        const badgeChecks = await Promise.all(
          BADGE_MILESTONES.map(async (milestone) => {
            const [hasCV, tokenCV, uriCV] = await Promise.all([
              fetchCallReadOnlyFunction({
                contractAddress: CONTRACT_ADDRESS,
                contractName: CONTRACT_NAME,
                functionName: "has-badge-kind",
                functionArgs: [principalCV(sender), uintCV(milestone.kind)],
                network: STACKS_NETWORK_OBJ,
                senderAddress: sender,
              }),
              fetchCallReadOnlyFunction({
                contractAddress: CONTRACT_ADDRESS,
                contractName: CONTRACT_NAME,
                functionName: "get-badge-token-id",
                functionArgs: [principalCV(sender), uintCV(milestone.kind)],
                network: STACKS_NETWORK_OBJ,
                senderAddress: sender,
              }),
              fetchCallReadOnlyFunction({
                contractAddress: CONTRACT_ADDRESS,
                contractName: CONTRACT_NAME,
                functionName: "get-badge-uri",
                functionArgs: [uintCV(milestone.kind)],
                network: STACKS_NETWORK_OBJ,
                senderAddress: sender,
              }),
            ]);
            return {
              kind: milestone.kind,
              has: Boolean(cvToValue(hasCV)),
              token: cvToValue(tokenCV) as unknown,
              uri: cvToValue(uriCV) as unknown,
            };
          })
        );

        const nextStatus: Record<number, boolean> = {};
        const nextTokenIds: Record<number, number | null> = {};
        const nextUris: Record<number, string | null> = {};
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

          nextUris[entry.kind] =
            typeof entry.uri === "string" ? entry.uri : null;
        }

        setBadgeSupport("v2");
        setBadgeStatus(nextStatus);
        setBadgeTokenIds(nextTokenIds);
        setBadgeUris(nextUris);
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
        setBadgeUris({});
      }

      setStatus("On-chain data refreshed");
    } catch {
      setError("Failed to fetch on-chain data.");
    } finally {
      setIsLoading(false);
    }
  }, [address]);

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
        onFinish: (data) => {
          setLastTxId(data.txId ?? "");
          setStatus("Claim submitted");
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
        onFinish: (data) => {
          setLastTxId(data.txId ?? "");
          setStatus("Mint submitted");
          // Refresh shortly after submit so the UI catches up once confirmed.
          setTimeout(() => {
            fetchOnChain();
          }, 1500);
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

  const fetchCustomKind = async () => {
    if (badgeSupport !== "v2") {
      setError("Custom milestones require the V2 contract.");
      return;
    }

    const kind = Number(customKind);
    if (!Number.isFinite(kind) || kind <= 0) {
      setError("Enter a valid milestone number (e.g. 60).");
      return;
    }

    setIsLoading(true);
    setError("");

    const sender = address || CONTRACT_ADDRESS;

    try {
      const [hasCV, tokenCV, uriCV] = await Promise.all([
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
        fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "get-badge-uri",
          functionArgs: [uintCV(kind)],
          network: STACKS_NETWORK_OBJ,
          senderAddress: sender,
        }),
      ]);

      setCustomHas(Boolean(cvToValue(hasCV)));
      const token = cvToValue(tokenCV) as unknown;
      if (token === null) setCustomTokenId(null);
      else if (typeof token === "bigint") setCustomTokenId(Number(token));
      else if (typeof token === "number") setCustomTokenId(token);
      else setCustomTokenId(null);

      const uriVal = cvToValue(uriCV) as unknown;
      setCustomUri(typeof uriVal === "string" ? uriVal : null);
      setStatus("Custom milestone loaded");
    } catch {
      setError("Failed to load custom milestone.");
    } finally {
      setIsLoading(false);
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
              <button
                className={`${styles.button} ${styles.ghostButton}`}
                onClick={disconnectWallet}
              >
                Disconnect
              </button>
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
            <div className={styles.heroActions}>
              <button className={styles.button} onClick={claimStreak}>
                Claim Now
              </button>
              <button
                className={`${styles.button} ${styles.ghostButton}`}
                onClick={fetchOnChain}
                disabled={isLoading}
              >
                {isLoading ? "Refreshing..." : "Refresh On-Chain"}
              </button>
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Wallet status</h2>
              <span className={styles.pill}>
                {STACKS_NETWORK === "mainnet" ? "Mainnet" : "Testnet"}
              </span>
            </div>
            <div className={styles.stack}>
              <div className={styles.status}>
                Status: <span>{status}</span>
              </div>
              <div className={styles.field}>
                Connected address
                <code>{shortAddress}</code>
              </div>
              <div className={styles.field}>
                Current streak
                <code>{streak ?? "Not loaded"}</code>
              </div>
              <div className={styles.field}>
                Last claim day
                <code>{lastClaimDay ?? "Not loaded"}</code>
              </div>
              {lastTxId ? (
                <div className={styles.field}>
                  Last tx id
                  <code>{lastTxId}</code>
                </div>
              ) : null}
              {error ? <div className={styles.danger}>{error}</div> : null}
            </div>
          </div>
        </section>

        <section className={styles.panelGrid}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Claim your streak</h2>
              <span className={styles.pill}>Daily</span>
            </div>
            <div className={styles.stack}>
              <div className={styles.field}>
                Contract
                <code>
                  {CONTRACT_ADDRESS}.{CONTRACT_NAME}
                </code>
              </div>
              <div className={styles.footnote}>
                Deployed on Stacks {STACKS_NETWORK}.
              </div>
            </div>
          </div>

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
                  const tokenUri = badgeUris[milestone.kind];

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
                              ? "Earned"
                              : "Not yet"}
                          </span>
                        </div>
                        {earned && tokenId !== undefined && tokenId !== null ? (
                          <div className={styles.badgeLine}>
                            Token: <code>{tokenId}</code>
                          </div>
                        ) : null}
                        {tokenUri ? (
                          <div className={styles.badgeLine}>
                            Metadata: <code>{tokenUri}</code>
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

              <div className={styles.field}>
                Badge support
                <code>
                  {badgeSupport === null ? "Not loaded" : badgeSupport.toUpperCase()}
                </code>
              </div>

              {badgeSupport === "v2" ? (
                <div className={styles.field}>
                  Custom milestone
                  <div className={styles.customRow}>
                    <input
                      className={styles.input}
                      inputMode="numeric"
                      placeholder="e.g. 60"
                      value={customKind}
                      onChange={(e) => setCustomKind(e.target.value)}
                    />
                    <button
                      className={`${styles.button} ${styles.ghostButton}`}
                      onClick={fetchCustomKind}
                      disabled={isLoading}
                    >
                      Check
                    </button>
                    <button
                      className={styles.button}
                      onClick={() => mintBadgeKind(Number(customKind))}
                      disabled={
                        !address ||
                        !customKind ||
                        Boolean(customHas) ||
                        (typeof streak === "number" &&
                          Number(customKind) > 0 &&
                          streak < Number(customKind))
                      }
                    >
                      Mint
                    </button>
                  </div>
                  <div className={styles.footnote}>
                    Status:{" "}
                    <code>
                      {customHas === null
                        ? "Not loaded"
                        : customHas
                        ? "Earned"
                        : "Not yet"}
                      {customTokenId !== null ? ` (token ${customTokenId})` : ""}
                    </code>
                  </div>
                  {customUri ? (
                    <div className={styles.footnote}>
                      Metadata: <code>{customUri}</code>
                    </div>
                  ) : null}
                </div>
              ) : null}

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
      </div>
    </div>
  );
}
