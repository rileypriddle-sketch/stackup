"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as StacksConnect from "@stacks/connect";
import { STACKS_MAINNET } from "@stacks/network";
import {
  cvToValue,
  fetchCallReadOnlyFunction,
  principalCV,
} from "@stacks/transactions";
import styles from "./page.module.css";

const APP_NAME = "StackUp";
const APP_ICON_PATH = "/icons/icon.png";

// TODO: replace with your deployed contract details before mainnet launch.
const CONTRACT_ADDRESS = "STXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const CONTRACT_NAME = "streak";

type StxAddress = { mainnet?: string; testnet?: string };
type UserProfile = { stxAddress?: StxAddress };
type UserData = { profile?: UserProfile };

type ConnectModule = typeof StacksConnect & {
  showConnect?: (options: StacksConnect.AuthOptions) => void;
  showBlockstackConnect?: (options: StacksConnect.AuthOptions) => void;
  openContractCall?: (options: StacksConnect.ContractCallOptions) => void;
  showContractCall?: (options: StacksConnect.ContractCallOptions) => void;
  default?: {
    showConnect?: (options: StacksConnect.AuthOptions) => void;
    openContractCall?: (options: StacksConnect.ContractCallOptions) => void;
  };
};

export default function Home() {
  const connectModule = StacksConnect as ConnectModule;
  const showConnectFn =
    connectModule.showConnect ??
    connectModule.showBlockstackConnect ??
    connectModule.default?.showConnect;
  const openContractCallFn =
    connectModule.openContractCall ??
    connectModule.showContractCall ??
    connectModule.default?.openContractCall;

  const userSession = useMemo(
    () =>
      new StacksConnect.UserSession({
        appConfig: new StacksConnect.AppConfig(["store_write"]),
      }),
    []
  );
  const [userData, setUserData] = useState<UserData | null>(null);
  const [status, setStatus] = useState<string>("Not connected");
  const [error, setError] = useState<string>("");
  const [lastTxId, setLastTxId] = useState<string>("");
  const [streak, setStreak] = useState<number | null>(null);
  const [lastClaimDay, setLastClaimDay] = useState<number | null>(null);
  const [hasBadge, setHasBadge] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (userSession.isUserSignedIn()) {
      setUserData(userSession.loadUserData());
      setStatus("Wallet connected");
      return;
    }

    if (userSession.isSignInPending()) {
      userSession
        .handlePendingSignIn()
        .then((data) => {
          setUserData(data);
          setStatus("Wallet connected");
        })
        .catch(() => {
          setError("Could not finish sign-in.");
          setStatus("Not connected");
        });
    }
  }, [userSession]);

  const address =
    userData?.profile?.stxAddress?.mainnet ??
    userData?.profile?.stxAddress?.testnet ??
    "";
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "Not connected";

  const connectWallet = () => {
    setError("");
    setStatus("Opening wallet...");
    if (!showConnectFn) {
      setError("Wallet connect is unavailable. Check @stacks/connect install.");
      setStatus("Not connected");
      return;
    }
    showConnectFn({
      userSession,
      appDetails: {
        name: APP_NAME,
        icon:
          typeof window === "undefined"
            ? APP_ICON_PATH
            : new URL(APP_ICON_PATH, window.location.origin).toString(),
      },
      onFinish: () => {
        setUserData(userSession.loadUserData());
        setStatus("Wallet connected");
      },
      onCancel: () => {
        setStatus("Connection cancelled");
      },
    });
  };

  const disconnectWallet = () => {
    userSession.signUserOut(window.location.origin);
    setUserData(null);
    setStatus("Not connected");
  };

  const fetchOnChain = useCallback(async () => {
    if (!CONTRACT_ADDRESS.startsWith("ST")) {
      setError("Set the contract address before fetching on-chain data.");
      return;
    }

    setIsLoading(true);
    setError("");

    const sender = address || CONTRACT_ADDRESS;

    try {
      const [streakCV, lastDayCV, badgeCV] = await Promise.all([
        fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "get-streak",
          functionArgs: [principalCV(sender)],
          network: STACKS_MAINNET,
          senderAddress: sender,
        }),
        fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "get-last-claim-day",
          functionArgs: [principalCV(sender)],
          network: STACKS_MAINNET,
          senderAddress: sender,
        }),
        fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "has-badge",
          functionArgs: [principalCV(sender)],
          network: STACKS_MAINNET,
          senderAddress: sender,
        }),
      ]);

      const streakValue = cvToValue(streakCV) as unknown;
      const lastDayValue = cvToValue(lastDayCV) as unknown;
      const badgeValue = cvToValue(badgeCV) as unknown;
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
      setHasBadge(Boolean(badgeValue));
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

  const claimStreak = () => {
    setError("");
    setStatus("Submitting claim...");

    try {
      if (!openContractCallFn) {
        setError("Contract call is unavailable. Check @stacks/connect install.");
        setStatus("Claim failed");
        return;
      }
      openContractCallFn({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "claim",
        functionArgs: [],
        network: STACKS_MAINNET,
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
              style={{ width: "100%", height: "auto" }}
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
              StackUp tracks your daily claim on Stacks mainnet. Claim once per
              day to build momentum and unlock your 7-day NFT badge.
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
              <span className={styles.pill}>Mainnet</span>
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
                <span className={styles.warn}>Heads up:</span> the contract
                address above is a placeholder. Update it after deployment.
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Badge milestone</h2>
              <span className={styles.pill}>NFT</span>
            </div>
            <div className={styles.stack}>
              <div className={styles.badgeRow}>
                <div className={styles.badge}>
                  <strong>7</strong> day streak badge
                </div>
              </div>
              <div className={styles.status}>
                Badge status:{" "}
                <span
                  className={
                    hasBadge === null
                      ? ""
                      : hasBadge
                      ? styles.success
                      : styles.warn
                  }
                >
                  {hasBadge === null ? "Not loaded" : hasBadge ? "Earned" : "Not yet"}
                </span>
              </div>
              <div className={styles.footnote}>
                Badge mints are triggered by the on-chain <code>claim</code>{" "}
                function once your streak hits 7.
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
