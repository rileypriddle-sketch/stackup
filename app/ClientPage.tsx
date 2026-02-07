"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { connect, disconnect, openContractCall, request } from "@stacks/connect";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import {
  PostConditionMode,
  cvToValue,
  fetchCallReadOnlyFunction,
  hexToCV,
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

const unwrapCvToValue = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") {
    return v;
  }

  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;

    // Some cvToValue outputs wrap optionals/responses as { type, value } or { value }.
    if ("value" in obj) return unwrapCvToValue(obj.value);
    if ("data" in obj) return unwrapCvToValue(obj.data);
  }

  return null;
};

export default function ClientPage() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [status, setStatus] = useState<string>("Not connected");
  const [error, setError] = useState<string>("");
  const [streak, setStreak] = useState<number | null>(null);
  const [lastClaimDay, setLastClaimDay] = useState<number | null>(null);
  const [lastClaimLabel, setLastClaimLabel] = useState<string>("—");
  const [hasBadge, setHasBadge] = useState<boolean | null>(null);
  const [badgeSupport, setBadgeSupport] = useState<"v1" | "v2" | null>(null);
  const [badgeStatus, setBadgeStatus] = useState<Record<number, boolean>>({});
  const [badgeTokenIds, setBadgeTokenIds] = useState<
    Record<number, number | null>
  >({});
  const [milestones, setMilestones] = useState<number[] | null>(null);
  const [badgeUris, setBadgeUris] = useState<Record<number, string | null>>({});
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
  const [collectibles, setCollectibles] = useState<OwnedCollectible[]>([]);
  const [collectiblesStatus, setCollectiblesStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [infernoFeeUstx, setInfernoFeeUstx] = useState<number | null>(null);
  const [infernoUri, setInfernoUri] = useState<string | null>(null);
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

  const stacksApiBase =
    STACKS_NETWORK === "mainnet"
      ? "https://api.mainnet.hiro.so"
      : "https://api.testnet.hiro.so";

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

  const resolveLocalNftImage = useCallback(async (tokenId: number, kind: number | null) => {
    const candidates: string[] = [];
    if (kind !== null) candidates.push(`/nfts/kind-${kind}.png`);
    candidates.push(`/nfts/token-${tokenId}.png`);
    // legacy/manual naming pattern (common during early drops)
    candidates.push(`/nfts/${tokenId}.png`);

    for (const path of candidates) {
      try {
        const res = await fetch(path, { method: "HEAD" });
        if (res.ok) return path;
      } catch {
        // ignore
      }
    }
    return null;
  }, []);

  const loadOwnedCollectibles = useCallback(
    async (principal: string) => {
      if (!principal) {
        setCollectibles([]);
        setCollectiblesStatus("idle");
        return;
      }

      const assetIdentifier = `${CONTRACT_ADDRESS}.${CONTRACT_NAME}::badge`;
      setCollectiblesStatus("loading");

      try {
        const res = await fetch(
          `${stacksApiBase}/extended/v1/tokens/nft/holdings?principal=${encodeURIComponent(
            principal
          )}&limit=200&offset=0`
        );

        if (!res.ok) throw new Error("holdings fetch failed");

        const body: unknown = await res.json();
        const results = Array.isArray((body as { results?: unknown }).results)
          ? ((body as { results: unknown[] }).results as unknown[])
          : [];

        const tokenIds: number[] = [];
        for (const row of results) {
          const r = row as {
            asset_identifier?: unknown;
            value?: unknown;
            token_id?: unknown;
          };

          if (r.asset_identifier !== assetIdentifier) continue;

          const v = r.value ?? r.token_id;
          let tokenId: number | null = null;

          if (typeof v === "string") {
            const m = v.match(/^u(\d+)$/);
            if (m?.[1]) tokenId = Number(m[1]);
            else if (/^\d+$/.test(v)) tokenId = Number(v);
          } else if (typeof v === "object" && v !== null && "hex" in v) {
            const hex = (v as { hex?: unknown }).hex;
            if (typeof hex === "string") {
              const cv = hexToCV(hex);
              const val = cvToValue(cv) as unknown;
              if (typeof val === "bigint") tokenId = Number(val);
              else if (typeof val === "number") tokenId = val;
            }
          }

          if (tokenId && Number.isFinite(tokenId)) tokenIds.push(tokenId);
        }

        if (tokenIds.length === 0) {
          setCollectibles([]);
          setCollectiblesStatus("loaded");
          return;
        }

        const tokenInfo = await Promise.all(
          tokenIds.map(async (tokenId) => {
            const [kindCV, uriCV] = await Promise.all([
              fetchCallReadOnlyFunction({
                contractAddress: CONTRACT_ADDRESS,
                contractName: CONTRACT_NAME,
                functionName: "get-badge-kind",
                functionArgs: [uintCV(tokenId)],
                network: STACKS_NETWORK_OBJ,
                senderAddress: principal,
              }),
              fetchCallReadOnlyFunction({
                contractAddress: CONTRACT_ADDRESS,
                contractName: CONTRACT_NAME,
                functionName: "get-token-uri",
                functionArgs: [uintCV(tokenId)],
                network: STACKS_NETWORK_OBJ,
                senderAddress: principal,
              }),
            ]);

            const kindUnwrapped = unwrapCvToValue(cvToValue(kindCV) as unknown);
            const kind =
              kindUnwrapped === null
                ? null
                : typeof kindUnwrapped === "bigint"
                  ? Number(kindUnwrapped)
                  : typeof kindUnwrapped === "number"
                    ? kindUnwrapped
                    : null;

            const uriUnwrapped = unwrapCvToValue(cvToValue(uriCV) as unknown);
            const metadataUri = typeof uriUnwrapped === "string" ? uriUnwrapped : null;

            return { tokenId, kind, metadataUri };
          })
        );

        const badgeKinds = new Set<number>(BADGE_MILESTONES.map((m) => m.kind));
        const badgeTokenIdSet = new Set<number>(
          Object.values(badgeTokenIds)
            .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        );
        const badgeUriSet = new Set<string>(
          Object.values(badgeUris)
            .filter((v): v is string => typeof v === "string" && v.length > 0)
        );

        const collectibleItems: OwnedCollectible[] = [];
        for (const info of tokenInfo) {
          if (badgeTokenIdSet.has(info.tokenId)) continue;
          if (info.kind !== null && badgeKinds.has(info.kind)) continue;
          if (info.metadataUri && badgeUriSet.has(info.metadataUri)) continue;
          if (info.kind === null) {
            // If we can't resolve kind, treat it as non-badge but keep it safe in UI.
          }

          const override = getOverrideForToken(info.tokenId, info.kind);

          let name =
            override?.name ||
            (info.kind === null
              ? `Token #${info.tokenId}`
              : `Collectible u${info.kind}`);
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
        setCollectibles([]);
        setCollectiblesStatus("error");
      }
    },
    [stacksApiBase, getOverrideForToken, resolveLocalNftImage, badgeTokenIds, badgeUris]
  );

  useEffect(() => {
    let cancelled = false;

    async function resolveLastClaim() {
      if (lastClaimDay === null) {
        setLastClaimLabel("—");
        return;
      }

      // Our contract defines day = floor(stacks-block-height / 144)
      // Use the first block height in that day to anchor a real timestamp.
      const height = lastClaimDay * 144;
      try {
        const res = await fetch(
          `${stacksApiBase}/extended/v1/block/by_height/${height}`
        );
        if (!res.ok) throw new Error("bad response");
        const body = (await res.json()) as unknown;

        const burnTime =
          typeof body === "object" && body !== null && "burn_block_time" in body
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (body as any).burn_block_time
            : null;

        const seconds =
          typeof burnTime === "number"
            ? burnTime
            : typeof burnTime === "string"
            ? Number(burnTime)
            : NaN;

        if (!Number.isFinite(seconds)) throw new Error("missing time");

        const date = new Date(seconds * 1000);
        const iso = date.toISOString().slice(0, 10);
        if (!cancelled) setLastClaimLabel(iso);
      } catch {
        if (!cancelled) setLastClaimLabel(`Day ${lastClaimDay}`);
      }
    }

    resolveLastClaim();
    return () => {
      cancelled = true;
    };
  }, [lastClaimDay, stacksApiBase]);

  const fetchContractOwner = useCallback(async () => {
    // Pull `contract-owner` data-var via Stacks API since it's not exposed as a read-only.
    try {
      const res = await fetch(
        `${stacksApiBase}/v2/data_var/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/contract-owner`
      );
      if (!res.ok) return;
      const body = (await res.json()) as unknown;

      // Hiro returns `{ data: "0x..." }` (Clarity hex) for data-vars.
      const data =
        typeof body === "object" && body !== null && "data" in body
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (body as any).data
          : null;

      if (typeof data === "string" && data.startsWith("0x")) {
        const cv = hexToCV(data);
        const val = cvToValue(cv) as unknown;
        if (typeof val === "string" && (val.startsWith("SP") || val.startsWith("ST"))) {
          setContractOwner(val);
          return;
        }
      }

      // Fallback for any other representation.
      const repr =
        typeof body === "object" && body !== null && "repr" in body
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (body as any).repr
          : null;
      if (typeof repr === "string") {
        const match = repr.match(/(SP|ST)[A-Z0-9]{20,}/);
        if (match?.[0]) setContractOwner(match[0]);
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
        const [milestonesCV, infernoFeeCV, infernoUriCV] = await Promise.all([
          fetchCallReadOnlyFunction({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "get-milestones",
            functionArgs: [],
            network: STACKS_NETWORK_OBJ,
            senderAddress,
          }),
          fetchCallReadOnlyFunction({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "get-mint-fee-kind",
            functionArgs: [uintCV(INFERNO_PULSE.kind)],
            network: STACKS_NETWORK_OBJ,
            senderAddress,
          }),
          fetchCallReadOnlyFunction({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "get-badge-uri",
            functionArgs: [uintCV(INFERNO_PULSE.kind)],
            network: STACKS_NETWORK_OBJ,
            senderAddress,
          }),
        ]);

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

        const feeUnwrapped = unwrapCvToValue(cvToValue(infernoFeeCV) as unknown);
        const fee =
          feeUnwrapped === null
            ? null
            : typeof feeUnwrapped === "bigint"
              ? Number(feeUnwrapped)
              : typeof feeUnwrapped === "number"
                ? feeUnwrapped
                : null;
        setInfernoFeeUstx(fee);

        const uriUnwrapped = unwrapCvToValue(cvToValue(infernoUriCV) as unknown);
        setInfernoUri(typeof uriUnwrapped === "string" ? uriUnwrapped : null);

        try {
          const kindsToLoad = BADGE_MILESTONES.map((m) => m.kind);
          const uriPairs = await Promise.all(
            kindsToLoad.map(async (kind) => {
              const v = await fetchCallReadOnlyFunction({
                contractAddress: CONTRACT_ADDRESS,
                contractName: CONTRACT_NAME,
                functionName: "get-badge-uri",
                functionArgs: [uintCV(kind)],
                network: STACKS_NETWORK_OBJ,
                senderAddress,
              });
              const u = unwrapCvToValue(cvToValue(v) as unknown);
              return [kind, typeof u === "string" ? u : null] as const;
            })
          );
          const nextMap: Record<number, string | null> = {};
          for (const [k, u] of uriPairs) nextMap[k] = u;
          setBadgeUris(nextMap);
        } catch {
          // ignore
        }

      } catch {
        // Older contracts might not expose these admin read-only endpoints.
        setMilestones(null);
      }

      if (senderOverride || address) {
        await loadOwnedCollectibles(sender);
      } else {
        setCollectibles([]);
        setCollectiblesStatus("idle");
      }

      setStatus("On-chain data refreshed");
    } catch {
      setError("Failed to fetch on-chain data.");
    } finally {
      setIsLoading(false);
    }
  }, [address, loadOwnedCollectibles]);

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

  const mintInfernoPulse = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (infernoFeeUstx === null) {
      setError("Price not loaded yet. Click “Refresh On-Chain” and try again.");
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
                  <span className={styles.walletSub}>View on-chain</span>
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
              <button
                className={`${styles.button} ${styles.ghostButton}`}
                onClick={() => fetchOnChain()}
                disabled={isLoading}
              >
                {isLoading ? "Refreshing..." : "Refresh On-Chain"}
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
              <div className={styles.dropCard}>
                <div className={styles.dropLeft}>
                  <div className={styles.dropThumb}>
                    <Image
                      src={INFERNO_PULSE.localImagePath}
                      alt={INFERNO_PULSE.name}
                      width={96}
                      height={96}
                      unoptimized
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  </div>
                  <div className={styles.dropMeta}>
                    <div className={styles.dropTitle}>{INFERNO_PULSE.name}</div>
                    <div className={styles.dropLine}>
                      Kind <code>u{INFERNO_PULSE.kind}</code>
                      {" · "}
                      {infernoFeeUstx === null
                        ? "Price: —"
                        : `Price: ${(infernoFeeUstx / 1_000_000).toFixed(2)} STX`}
                    </div>
                    <div className={styles.dropLine}>
                      Metadata:{" "}
                      <span>
                        {infernoUri ? "Configured" : "Not configured"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className={styles.dropRight}>
                  <button
                    className={styles.button}
                    onClick={mintInfernoPulse}
                    disabled={!address || !infernoUri}
                    type="button"
                  >
                    Mint
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
                    Try “Refresh On-Chain” again in a moment.
                  </div>
                </div>
              ) : collectibles.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyTitle}>No NFTs yet.</div>
                  <div className={styles.emptyBody}>
                    When you mint paid collectibles, they’ll appear here.
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
