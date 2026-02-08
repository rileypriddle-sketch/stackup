"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { connect, disconnect, openContractCall, request } from "@stacks/connect";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import {
  PostConditionMode,
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
const ENV_STACKS_NETWORK = (process.env.NEXT_PUBLIC_STACKS_NETWORK ??
  "mainnet") as "mainnet" | "testnet";

// Cloudflare Pages env vars are easy to misconfigure. Derive the network from the
// contract address first (SP=mainnet, ST=testnet), and only fall back to the env.
const STACKS_NETWORK = (CONTRACT_ADDRESS.startsWith("SP")
  ? "mainnet"
  : CONTRACT_ADDRESS.startsWith("ST")
    ? "testnet"
    : ENV_STACKS_NETWORK) as "mainnet" | "testnet";

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

type OwnedCollectible = {
  tokenId: number;
  kind: number | null;
  name: string;
  imageUrl: string | null;
  metadataUri: string | null;
};

const INFERNO_PULSE = {
  metadataCid: "bafkreictvrsqz6gg6yxhqwlrdbnpafyrk72wcyc6odejbkyhtg7qmk2g5y",
  imageCid: "bafybeidm2pqh5ty5ltlt4zpl3osy2t27annf5zui5ur6j6uxwk2oco24zm",
  localImagePath: "/nfts/inferno-pulse.png",
  name: "StackUp: Inferno Pulse",
  kind: 101,
} as const;

const STORM_ASSASIN = {
  metadataCid: "bafkreiavecfbxphf3qejwyktvh5eosa7eveqghcft4sjcrfugrxqat6wbi",
  imageCid: "bafybeie7ot5lpvbjkwpxnky4hzovbotim5266hsnyag7qff6ekxpeiqelm",
  localImagePath: "/nfts/storm-assassin.png",
  name: "StackUp: Storm Assasin",
  kind: 102,
} as const;

type NftOverrideEntry = {
  name?: string;
  image?: string; // /public path or ipfs://...
};

type NftOverrides = {
  byTokenId: Record<string, NftOverrideEntry>;
  byKind: Record<string, NftOverrideEntry>;
};

const NFT_OVERRIDES_STORAGE_KEY = "stackup_nft_overrides_v1";

const ipfsToHttpsCandidates = (uri: string) => {
  if (!uri.startsWith("ipfs://")) return [uri];
  const cid = uri.slice("ipfs://".length);
  return [
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://gateway.pinata.cloud/ipfs/${cid}`,
    `https://ipfs.io/ipfs/${cid}`,
  ];
};

export default function ClientPage() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [status, setStatus] = useState<string>("Not connected");
  const [error, setError] = useState<string>("");
  const [streak, setStreak] = useState<number | null>(null);
  const [lastClaimLabel, setLastClaimLabel] = useState<string>("—");
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
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [collectibles, setCollectibles] = useState<OwnedCollectible[]>([]);
  const [collectiblesStatus, setCollectiblesStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [infernoFeeUstx, setInfernoFeeUstx] = useState<number | null>(null);
  const [infernoUri, setInfernoUri] = useState<string | null>(null);
  const [stormFeeUstx, setStormFeeUstx] = useState<number | null>(null);
  const [stormUri, setStormUri] = useState<string | null>(null);
  const [featuredDrops, setFeaturedDrops] = useState<{
    inferno: OwnedCollectible | null;
    storm: OwnedCollectible | null;
  }>({ inferno: null, storm: null });
  const [didAutoForceRefresh, setDidAutoForceRefresh] = useState<boolean>(false);
  const inFlightOnChain = useRef<{ key: string; promise: Promise<void> } | null>(
    null
  );
  const [nftOverrides, setNftOverrides] = useState<NftOverrides>({
    byTokenId: {},
    byKind: {},
  });
  const [adminNftMode, setAdminNftMode] = useState<"token" | "kind">("token");
  const [adminNftId, setAdminNftId] = useState<string>("101");
  const [adminNftName, setAdminNftName] = useState<string>("");
  const [adminNftImage, setAdminNftImage] = useState<string>("/nfts/");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NFT_OVERRIDES_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return;
      const obj = parsed as Partial<NftOverrides>;
      setNftOverrides({
        byTokenId: typeof obj.byTokenId === "object" && obj.byTokenId ? (obj.byTokenId as Record<string, NftOverrideEntry>) : {},
        byKind: typeof obj.byKind === "object" && obj.byKind ? (obj.byKind as Record<string, NftOverrideEntry>) : {},
      });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(NFT_OVERRIDES_STORAGE_KEY, JSON.stringify(nftOverrides));
    } catch {
      // ignore
    }
  }, [nftOverrides]);

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

  const shareApp = async () => {
    try {
      const url = window.location.href;
      const title = "StackUp";
      const text = "Daily streaks on Stacks.";

      if (navigator.share) {
        await navigator.share({ title, text, url });
        setStatus("Share sheet opened");
        return;
      }

      await navigator.clipboard.writeText(url);
      setStatus("Link copied");
    } catch {
      setStatus("Share failed");
    }
  };

  const getOverrideForToken = useCallback(
    (tokenId: number, kind: number | null) => {
      const byToken = nftOverrides.byTokenId[String(tokenId)];
      if (byToken) return byToken;
      if (kind !== null) {
        const byKind = nftOverrides.byKind[String(kind)];
        if (byKind) return byKind;
      }
      return null;
    },
    [nftOverrides]
  );

  const resolveLocalNftImage = useCallback(
    async (_tokenId: number, kind: number | null) => {
      // Avoid probing for unknown local files (causes noisy 404s in the console).
      // Only return known bundled assets.
      if (kind === INFERNO_PULSE.kind) return INFERNO_PULSE.localImagePath;
      if (kind === STORM_ASSASIN.kind) return STORM_ASSASIN.localImagePath;
      return null;
    },
    []
  );

  type CollectibleTokenInfo = {
    tokenId: number;
    kind: number | null;
    metadataUri: string | null;
  };

  const hydrateCollectiblesFromTokenInfo = useCallback(
    async (tokenInfo: CollectibleTokenInfo[]) => {
      setCollectiblesStatus("loading");
      try {
        if (tokenInfo.length === 0) {
          setFeaturedDrops({ inferno: null, storm: null });
          setCollectibles([]);
          setCollectiblesStatus("loaded");
          return;
        }

        // Feature the two paid drops so they don't show up twice (once as a drop tile, once in the owned list).
        const infernoOwnedRaw = tokenInfo
          .filter(
            (t) =>
              t.kind === INFERNO_PULSE.kind ||
              (t.metadataUri?.endsWith(INFERNO_PULSE.metadataCid) ?? false)
          )
          .sort((a, b) => b.tokenId - a.tokenId)[0];
        const stormOwnedRaw = tokenInfo
          .filter(
            (t) =>
              t.kind === STORM_ASSASIN.kind ||
              (t.metadataUri?.endsWith(STORM_ASSASIN.metadataCid) ?? false)
          )
          .sort((a, b) => b.tokenId - a.tokenId)[0];

        setFeaturedDrops({
          inferno: infernoOwnedRaw
            ? {
                tokenId: infernoOwnedRaw.tokenId,
                kind: infernoOwnedRaw.kind,
                name: INFERNO_PULSE.name,
                imageUrl: INFERNO_PULSE.localImagePath,
                metadataUri: infernoOwnedRaw.metadataUri,
              }
            : null,
          storm: stormOwnedRaw
            ? {
                tokenId: stormOwnedRaw.tokenId,
                kind: stormOwnedRaw.kind,
                name: STORM_ASSASIN.name,
                imageUrl: STORM_ASSASIN.localImagePath,
                metadataUri: stormOwnedRaw.metadataUri,
              }
            : null,
        });

        const remaining = tokenInfo.filter((t) => {
          if (
            t.kind === INFERNO_PULSE.kind ||
            (t.metadataUri?.endsWith(INFERNO_PULSE.metadataCid) ?? false)
          ) {
            return false;
          }
          if (
            t.kind === STORM_ASSASIN.kind ||
            (t.metadataUri?.endsWith(STORM_ASSASIN.metadataCid) ?? false)
          ) {
            return false;
          }
          return true;
        });

        const collectibleItems: OwnedCollectible[] = [];
        for (const info of remaining) {
          const override = getOverrideForToken(info.tokenId, info.kind);

          let name =
            override?.name ||
            (info.kind === null ? `Token #${info.tokenId}` : `Collectible u${info.kind}`);
          let imageUrl: string | null = null;

          if (info.metadataUri) {
            try {
              if (info.metadataUri.endsWith(INFERNO_PULSE.metadataCid)) {
                name = INFERNO_PULSE.name;
                imageUrl = INFERNO_PULSE.localImagePath;
              } else {
                const urls = ipfsToHttpsCandidates(info.metadataUri);
                for (const url of urls) {
                  const mRes = await fetch(url);
                  if (!mRes.ok) continue;
                  const meta: unknown = await mRes.json();
                  const metaObj = meta as { name?: unknown; image?: unknown };
                  if (typeof metaObj.name === "string") name = metaObj.name;
                  if (typeof metaObj.image === "string") {
                    if (metaObj.image.endsWith(INFERNO_PULSE.imageCid)) {
                      imageUrl = INFERNO_PULSE.localImagePath;
                    } else {
                      imageUrl = ipfsToHttpsCandidates(metaObj.image)[0] ?? null;
                    }
                  }
                  break;
                }
              }
            } catch {
              // ignore metadata failures
            }
          }

          if (override?.image) {
            if (override.image.startsWith("ipfs://")) {
              imageUrl = ipfsToHttpsCandidates(override.image)[0] ?? null;
            } else {
              imageUrl = override.image;
            }
          }

          if (!imageUrl) {
            imageUrl = await resolveLocalNftImage(info.tokenId, info.kind);
          }

          collectibleItems.push({
            tokenId: info.tokenId,
            kind: info.kind,
            name,
            imageUrl,
            metadataUri: info.metadataUri,
          });
        }

        collectibleItems.sort((a, b) => b.tokenId - a.tokenId);
        setCollectibles(collectibleItems);
        setCollectiblesStatus("loaded");
      } catch {
        setFeaturedDrops({ inferno: null, storm: null });
        setCollectibles([]);
        setCollectiblesStatus("error");
      }
    },
    [getOverrideForToken, resolveLocalNftImage]
  );

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

  type OnChainApiOk = {
    ok: true;
    cached: boolean;
    fetchedAt: number;
    data: {
      contractOwner: string | null;
      milestones: number[] | null;
      badgeUris: Record<number, string | null>;
      infernoFeeUstx: number | null;
      infernoUri: string | null;
      stormFeeUstx: number | null;
      stormUri: string | null;
      streak: number | null;
      lastClaimDay: number | null;
      lastClaimLabel: string;
      badgeSupport: "v1" | "v2" | null;
      hasBadge: boolean | null;
      badgeStatus: Record<number, boolean>;
      badgeTokenIds: Record<number, number | null>;
      collectiblesTokenInfo: { tokenId: number; kind: number | null; metadataUri: string | null }[];
    };
  };

  type OnChainApiErr = { ok: false; error: string };

  const fetchOnChain = useCallback(
    async (senderOverride?: string, opts?: { force?: boolean }) => {
      if (!(CONTRACT_ADDRESS.startsWith("ST") || CONTRACT_ADDRESS.startsWith("SP"))) {
        setError("Set a valid contract address before fetching on-chain data (ST... or SP...).");
        return;
      }

      setError("");

      const sender = (senderOverride || walletAddress || "").trim();

      const url = new URL("/api/onchain", window.location.origin);
      if (sender) url.searchParams.set("sender", sender);
      if (opts?.force) url.searchParams.set("force", "1");
      const requestKey = url.toString();

      // Dedupe identical in-flight requests (connectWallet + useEffect, rapid re-renders, etc).
      // This is especially noticeable when you compare "direct call" (1 request) vs app boot (can be 2).
      const inFlight = inFlightOnChain.current;
      if (inFlight && inFlight.key === requestKey) return inFlight.promise;

      const promise = (async () => {
        try {
          const res = await fetch(requestKey);
          const body = (await res.json()) as unknown;

          if (!res.ok) {
            const msg =
              typeof body === "object" && body !== null && "error" in body
                ? String(
                    (body as { error?: unknown }).error ?? `HTTP ${res.status}`
                  )
                : `HTTP ${res.status}`;
            throw new Error(msg);
          }

          const parsed = body as OnChainApiOk | OnChainApiErr;
          if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
            throw new Error("Invalid on-chain response");
          }
          if (!parsed.ok) {
            throw new Error(parsed.error || "On-chain request failed");
          }

          const d = parsed.data;

          setContractOwner(d.contractOwner);
          setMilestones(d.milestones);
          if (Array.isArray(d.milestones) && d.milestones.length > 0) {
            setAdminMilestones(d.milestones.join(","));
          }

          setInfernoFeeUstx(d.infernoFeeUstx);
          setInfernoUri(d.infernoUri);
          setStormFeeUstx(d.stormFeeUstx);
          setStormUri(d.stormUri);

          setStreak(d.streak);
          setLastClaimLabel(
            typeof d.lastClaimLabel === "string" ? d.lastClaimLabel : "—"
          );

          setBadgeSupport(d.badgeSupport);
          setHasBadge(d.hasBadge);
          setBadgeStatus(d.badgeStatus ?? {});
          setBadgeTokenIds(d.badgeTokenIds ?? {});

          if (sender) {
            await hydrateCollectiblesFromTokenInfo(d.collectiblesTokenInfo ?? []);
          } else {
            setFeaturedDrops({ inferno: null, storm: null });
            setCollectibles([]);
            setCollectiblesStatus("idle");
          }

          const cached = Boolean(parsed.cached);
          setStatus(cached ? "On-chain data loaded" : "On-chain data updated");

          // Self-heal if we ever cached an incomplete snapshot (e.g. temporary upstream failures).
          const looksIncomplete =
            (d.infernoFeeUstx === null &&
              d.stormFeeUstx === null &&
              !Array.isArray(d.milestones)) ||
            (sender && d.streak === null);
          if (cached && looksIncomplete && !didAutoForceRefresh) {
            setDidAutoForceRefresh(true);
            setTimeout(() => {
              fetchOnChain(sender || undefined, { force: true }).catch(() => {
                // ignore
              });
            }, 250);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          setError(`Failed to load on-chain data: ${message}`);
        }
      })();

      inFlightOnChain.current = { key: requestKey, promise };
      promise.finally(() => {
        if (inFlightOnChain.current?.promise === promise) {
          inFlightOnChain.current = null;
        }
      });
      return promise;
    },
    [didAutoForceRefresh, hydrateCollectiblesFromTokenInfo, walletAddress]
  );

  const scheduleRefresh = useCallback(
    (senderOverride?: string) => {
      // Most transactions won't reflect immediately; refresh a couple times.
      setTimeout(() => fetchOnChain(senderOverride, { force: true }), 6_000);
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

  const upsertNftOverride = () => {
    const id = Number(adminNftId);
    if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
      setStatus("Invalid ID");
      return;
    }

    const entry: NftOverrideEntry = {};
    if (adminNftName.trim()) entry.name = adminNftName.trim();
    if (adminNftImage.trim()) entry.image = adminNftImage.trim();

    setNftOverrides((prev) => {
      const next: NftOverrides = {
        byTokenId: { ...prev.byTokenId },
        byKind: { ...prev.byKind },
      };
      if (adminNftMode === "token") next.byTokenId[String(id)] = entry;
      else next.byKind[String(id)] = entry;
      return next;
    });

    setStatus("NFT override saved");
  };

  const removeNftOverride = () => {
    const id = Number(adminNftId);
    if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
      setStatus("Invalid ID");
      return;
    }

    setNftOverrides((prev) => {
      const next: NftOverrides = {
        byTokenId: { ...prev.byTokenId },
        byKind: { ...prev.byKind },
      };
      if (adminNftMode === "token") delete next.byTokenId[String(id)];
      else delete next.byKind[String(id)];
      return next;
    });

    setStatus("NFT override removed");
  };

  const clearNftOverrides = () => {
    setNftOverrides({ byTokenId: {}, byKind: {} });
    setStatus("NFT overrides cleared");
  };

  useEffect(() => {
    fetchOnChain(address || undefined);
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

  const mintInfernoPulse = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (infernoFeeUstx === null) {
      setError("Price not loaded yet. Try again in a moment.");
      return;
    }

    setError("");
    setStatus("Minting Inferno Pulse...");

    try {
      openContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "mint-paid-kind",
        functionArgs: [uintCV(INFERNO_PULSE.kind)],
        // This call transfers STX as a mint fee. In Allow mode, the wallet
        // doesn't require us to enumerate the exact STX movement as a post-condition.
        postConditionMode: PostConditionMode.Allow,
        network: STACKS_NETWORK_OBJ,
        appDetails: {
          name: APP_NAME,
          icon: new URL(APP_ICON_PATH, window.location.origin).toString(),
        },
        onFinish: () => {
          setStatus("Mint submitted");
          scheduleRefresh(address);
        },
        onCancel: () => setStatus("Mint cancelled"),
      });
    } catch {
      setError("Failed to open mint transaction.");
      setStatus("Mint failed");
    }
  };

  const mintStormAssasin = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (stormFeeUstx === null) {
      setError("Price not loaded yet. Try again in a moment.");
      return;
    }

    setError("");
    setStatus("Minting Storm Assasin...");

    try {
      openContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "mint-paid-kind",
        functionArgs: [uintCV(STORM_ASSASIN.kind)],
        // This call transfers STX as a mint fee. In Allow mode, the wallet
        // doesn't require us to enumerate the exact STX movement as a post-condition.
        postConditionMode: PostConditionMode.Allow,
        network: STACKS_NETWORK_OBJ,
        appDetails: {
          name: APP_NAME,
          icon: new URL(APP_ICON_PATH, window.location.origin).toString(),
        },
        onFinish: () => {
          setStatus("Mint submitted");
          scheduleRefresh(address);
        },
        onCancel: () => setStatus("Mint cancelled"),
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
                  onClick={() => {
                    const chain = STACKS_NETWORK === "mainnet" ? "mainnet" : "testnet";
                    window.open(
                      `https://explorer.hiro.so/address/${address}?chain=${chain}`,
                      "_blank",
                      "noopener,noreferrer"
                    );
                  }}
                  type="button"
                >
                  <span className={styles.walletMain}>{shortAddress}</span>
                  <span className={styles.walletSub}>View in explorer</span>
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
              Track one claim per day on Stacks {STACKS_NETWORK}. Earn streak badges
              automatically as you hit milestones.
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
            </div>
            <div className={styles.statsRow}>
              <div className={styles.statChip}>
                <div className={styles.statLabel}>Streak</div>
                <div className={styles.statValue}>
                  {streak === null ? "—" : streak}
                </div>
              </div>
              <div className={styles.statChip}>
                <div className={styles.statLabel}>Last claim</div>
                <div className={styles.statValue}>
                  {lastClaimLabel}
                </div>
              </div>
              <button
                className={`${styles.button} ${styles.ghostButton} ${styles.shareButton}`}
                onClick={shareApp}
                type="button"
              >
                Share
              </button>
            </div>
            <div className={styles.statusLine}>
              Status: <span>{status}</span>
            </div>
            {error ? <div className={styles.danger}>{error}</div> : null}
            {!address ? (
              <div className={styles.footnote}>
                Connect your wallet to see your streak and last claim day.
              </div>
            ) : null}
          </div>
        </section>

        <section className={styles.panelGrid}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitleBlock}>
                <h2>Badges</h2>
                <div className={styles.panelSubtitle}>
                  Earned automatically when you hit streak milestones.
                </div>
              </div>
              <span className={styles.pill}>Streak</span>
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

                  const isLocked =
                    badgeSupport !== null &&
                    typeof streak === "number" &&
                    streak < milestone.kind;

                  const statusLabel =
                    badgeSupport === null
                      ? "Loading"
                      : earned
                      ? "Claimed"
                      : canMint
                      ? "Ready"
                      : isLocked
                      ? "Locked"
                      : "Not claimed";

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
                          <strong>{milestone.label}</strong>
                        </div>
                        <div className={styles.badgeLine}>
                          <span
                            className={
                              badgeSupport === null
                                ? ""
                                : earned
                                ? styles.success
                                : canMint
                                ? styles.success
                                : styles.warn
                            }
                          >
                            {statusLabel}
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

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitleBlock}>
                <h2>NFTs</h2>
                <div className={styles.panelSubtitle}>
                  Your owned collectibles.
                </div>
              </div>
              <span className={styles.pill}>Owned</span>
            </div>
            <div className={styles.stack}>
              <div className={styles.dropGrid}>
                <div className={styles.dropTile}>
                  <div className={styles.dropTileThumb}>
                    <Image
                      src={INFERNO_PULSE.localImagePath}
                      alt={INFERNO_PULSE.name}
                      width={520}
                      height={520}
                      unoptimized
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  </div>
                  <div className={styles.dropTileBody}>
                    <div className={styles.dropTileTitle}>{INFERNO_PULSE.name}</div>
                    <div className={styles.dropTileLine}>
                      Kind <code>u{INFERNO_PULSE.kind}</code>
                      {" · "}
                      {infernoFeeUstx === null
                        ? "Price: —"
                        : `Price: ${(infernoFeeUstx / 1_000_000).toFixed(2)} STX`}
                    </div>
                    <div className={styles.dropTileLine}>
                      Metadata:{" "}
                      <span>{infernoUri ? "Configured" : "Not configured"}</span>
                    </div>
                    {featuredDrops.inferno ? (
                      <div className={styles.dropTileLine}>
                        Owned: <code>#{featuredDrops.inferno.tokenId}</code>
                      </div>
                    ) : null}
                  </div>
                  <button
                    className={`${styles.button} ${styles.dropTileButton}`}
                    onClick={mintInfernoPulse}
                    disabled={!address || !infernoUri || Boolean(featuredDrops.inferno)}
                    type="button"
                  >
                    {featuredDrops.inferno ? "Owned" : "Mint"}
                  </button>
                </div>

                <div className={styles.dropTile}>
                  <div className={styles.dropTileThumb}>
                    <Image
                      src={STORM_ASSASIN.localImagePath}
                      alt={STORM_ASSASIN.name}
                      width={520}
                      height={520}
                      unoptimized
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  </div>
                  <div className={styles.dropTileBody}>
                    <div className={styles.dropTileTitle}>{STORM_ASSASIN.name}</div>
                    <div className={styles.dropTileLine}>
                      Kind <code>u{STORM_ASSASIN.kind}</code>
                      {" · "}
                      {stormFeeUstx === null
                        ? "Price: —"
                        : `Price: ${(stormFeeUstx / 1_000_000).toFixed(2)} STX`}
                    </div>
                    <div className={styles.dropTileLine}>
                      Metadata:{" "}
                      <span>{stormUri ? "Configured" : "Not configured"}</span>
                    </div>
                    {featuredDrops.storm ? (
                      <div className={styles.dropTileLine}>
                        Owned: <code>#{featuredDrops.storm.tokenId}</code>
                      </div>
                    ) : null}
                  </div>
                  <button
                    className={`${styles.button} ${styles.dropTileButton}`}
                    onClick={mintStormAssasin}
                    disabled={!address || !stormUri || Boolean(featuredDrops.storm)}
                    type="button"
                  >
                    {featuredDrops.storm ? "Owned" : "Mint"}
                  </button>
                </div>
              </div>

              {!address ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyTitle}>Connect to view NFTs.</div>
                  <div className={styles.emptyBody}>
                    We’ll show any collectibles you own from this contract.
                  </div>
                </div>
              ) : collectiblesStatus === "loading" ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyTitle}>Loading NFTs…</div>
                  <div className={styles.emptyBody}>Fetching your holdings.</div>
                </div>
              ) : collectiblesStatus === "error" ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyTitle}>Couldn’t load NFTs.</div>
                  <div className={styles.emptyBody}>
                    Try again in a moment.
                  </div>
                </div>
              ) : collectibles.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyTitle}>No other NFTs yet.</div>
                  <div className={styles.emptyBody}>
                    When you mint or receive more collectibles, they’ll appear here.
                  </div>
                </div>
              ) : (
                <div className={styles.nftGrid}>
                  {collectibles.map((nft) => (
                    <div key={nft.tokenId} className={styles.nftCard}>
                      <div className={styles.nftThumb}>
                        {nft.imageUrl ? (
                          <Image
                            src={nft.imageUrl}
                            alt={nft.name}
                            width={320}
                            height={320}
                            unoptimized
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                          />
                        ) : (
                          <div className={styles.thumbPlaceholder} />
                        )}
                      </div>
                      <div className={styles.nftMeta}>
                        <div className={styles.nftTitle}>
                          <strong>{nft.name}</strong>
                        </div>
                        <div className={styles.nftLine}>
                          Token <code>#{nft.tokenId}</code>
                          {nft.kind !== null ? (
                            <>
                              {" · "}Kind <code>u{nft.kind}</code>
                            </>
                          ) : null}
                        </div>
                        <div className={styles.nftLine}>
                          Metadata:{" "}
                          <span>{nft.metadataUri ? "Configured" : "Not configured"}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <div className={styles.footerText}>
              StackUp is a lightweight streak tracker on Stacks.
            </div>
            <button
              className={`${styles.button} ${styles.ghostButton} ${styles.shareButton}`}
              onClick={shareApp}
              type="button"
            >
              Share
            </button>
          </div>
        </footer>

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
                  <div className={styles.modalSub}>Owner-only controls.</div>
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

                  <div className={styles.adminSection}>
                    <div className={styles.adminTitle}>NFT Images (Instant)</div>
                    <div className={styles.adminRow}>
                      <select
                        className={styles.select}
                        value={adminNftMode}
                        onChange={(e) =>
                          setAdminNftMode(e.target.value === "kind" ? "kind" : "token")
                        }
                      >
                        <option value="token">Token ID</option>
                        <option value="kind">Kind</option>
                      </select>
                      <input
                        className={styles.input}
                        inputMode="numeric"
                        placeholder="id (e.g. 101)"
                        value={adminNftId}
                        onChange={(e) => setAdminNftId(e.target.value)}
                      />
                    </div>
                    <div className={styles.adminRow}>
                      <input
                        className={styles.input}
                        placeholder="name (optional)"
                        value={adminNftName}
                        onChange={(e) => setAdminNftName(e.target.value)}
                      />
                      <input
                        className={styles.input}
                        placeholder="image (/nfts/xxx.png or ipfs://...)"
                        value={adminNftImage}
                        onChange={(e) => setAdminNftImage(e.target.value)}
                      />
                    </div>
                    <div className={styles.adminRow}>
                      <button className={styles.button} onClick={upsertNftOverride}>
                        Save
                      </button>
                      <button
                        className={`${styles.button} ${styles.ghostButton}`}
                        onClick={removeNftOverride}
                        type="button"
                      >
                        Remove
                      </button>
                      <button
                        className={`${styles.button} ${styles.ghostButton}`}
                        onClick={clearNftOverrides}
                        type="button"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className={styles.footnote}>
                      Put images in <code>public/nfts/</code>. If IPFS is slow, the app
                      will also auto-try <code>/nfts/token-101.png</code> and{" "}
                      <code>/nfts/kind-777.png</code>.
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
