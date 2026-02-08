import {
  cvToValue,
  fetchCallReadOnlyFunction,
  hexToCV,
  principalCV,
  type ClarityValue,
  uintCV,
} from "@stacks/transactions";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import { getCacheJson, purgeExpired, setCacheJson, type D1DatabaseLike } from "../_lib/cache";

type Env = {
  DB: D1DatabaseLike;
};

type BadgeSupport = "v1" | "v2" | null;

type TokenInfo = {
  tokenId: number;
  kind: number | null;
  metadataUri: string | null;
};

type OnChainSnapshot = {
  contractOwner: string | null;
  milestones: number[] | null;
  badgeUris: Record<number, string | null>;
  infernoFeeUstx: number | null;
  infernoUri: string | null;
  stormFeeUstx: number | null;
  stormUri: string | null;
  currentDay: number | null;
  streak: number | null;
  lastClaimDay: number | null;
  lastClaimLabel: string;
  canClaim: boolean | null;
  badgeSupport: BadgeSupport;
  hasBadge: boolean | null;
  badgeStatus: Record<number, boolean>;
  badgeTokenIds: Record<number, number | null>;
  collectiblesTokenInfo: TokenInfo[];
};

type ApiResponse = { ok: true; cached: boolean; fetchedAt: number; data: OnChainSnapshot } | { ok: false; error: string };

const CONTRACT_ADDRESS = "SP2022VXQ3E384AAHQ15KFFXVN3CY5G57HWCCQX23";
const CONTRACT_NAME = "streak-v3-5";
const STACKS_NETWORK: "mainnet" | "testnet" = CONTRACT_ADDRESS.startsWith("ST")
  ? "testnet"
  : "mainnet";

const STACKS_NETWORK_OBJ = STACKS_NETWORK === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;
const STACKS_API_BASE = STACKS_NETWORK === "mainnet" ? "https://api.mainnet.hiro.so" : "https://api.testnet.hiro.so";

const BADGE_MILESTONE_KINDS = [1, 3, 7, 14, 30] as const;
const INFERNO_KIND = 101;
const STORM_KIND = 102;

function unwrapCvToValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  if (!("type" in obj)) return value;

  const t = obj.type;
  const v = "value" in obj ? obj.value : undefined;

  if (t === "none") return null;
  if (t === "some") return unwrapCvToValue(v);
  if (t === "ok") return unwrapCvToValue(v);
  if (t === "err") return unwrapCvToValue(v);

  if (t === "uint" || t === "int") {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(v);
    if (typeof v === "string") {
      try {
        return BigInt(v);
      } catch {
        return null;
      }
    }
  }

  if (
    t === "string-ascii" ||
    t === "string-utf8" ||
    t === "principal" ||
    t === "standard-principal" ||
    t === "contract-principal"
  ) {
    return typeof v === "string" ? v : null;
  }

  if (t === "list") return Array.isArray(v) ? v.map(unwrapCvToValue) : null;

  return null;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.length > 0) return Number(value);
  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithBackoff(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= tries) return res;
    const retryAfter = res.headers.get("Retry-After");
    const retryMs = retryAfter ? Number(retryAfter) * 1000 : 250 * attempt;
    await sleep(Number.isFinite(retryMs) ? retryMs : 500);
  }
}

async function callReadOnly(opts: {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: ClarityValue[];
  senderAddress: string;
}): Promise<unknown> {
  const cv = await fetchCallReadOnlyFunction({
    contractAddress: opts.contractAddress,
    contractName: opts.contractName,
    functionName: opts.functionName,
    functionArgs: opts.functionArgs,
    network: STACKS_NETWORK_OBJ,
    client: { baseUrl: STACKS_API_BASE },
    senderAddress: opts.senderAddress,
  });
  return unwrapCvToValue(cvToValue(cv) as unknown);
}

async function getContractOwner(): Promise<string | null> {
  const res = await fetchJsonWithBackoff(
    `${STACKS_API_BASE}/v2/data_var/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/contract-owner`
  );
  if (!res.ok) return null;
  const body = (await res.json()) as unknown;
  const data =
    typeof body === "object" && body !== null && "data" in body
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (body as any).data
      : null;

  if (typeof data === "string" && data.startsWith("0x")) {
    try {
      const cv = hexToCV(data);
      const val = cvToValue(cv) as unknown;
      if (typeof val === "string" && (val.startsWith("SP") || val.startsWith("ST"))) return val;
    } catch {
      // ignore
    }
  }

  const repr =
    typeof body === "object" && body !== null && "repr" in body
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (body as any).repr
      : null;
  if (typeof repr === "string") {
    const match = repr.match(/(SP|ST)[A-Z0-9]{20,}/);
    return match?.[0] ?? null;
  }

  return null;
}

async function resolveLastClaimLabel(lastClaimDay: number | null): Promise<string> {
  if (!lastClaimDay || !Number.isFinite(lastClaimDay) || lastClaimDay <= 0) return "—";
  const height = lastClaimDay * 144;
  try {
    const res = await fetchJsonWithBackoff(`${STACKS_API_BASE}/extended/v1/block/by_height/${height}`);
    if (!res.ok) throw new Error("bad response");
    const body = (await res.json()) as unknown;
    const burnTime =
      typeof body === "object" && body !== null && "burn_block_time" in body
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (body as any).burn_block_time
        : null;
    const seconds =
      typeof burnTime === "number" ? burnTime : typeof burnTime === "string" ? Number(burnTime) : NaN;
    if (!Number.isFinite(seconds)) throw new Error("missing time");
    const iso = new Date(seconds * 1000).toISOString().slice(0, 10);
    return iso;
  } catch {
    return `Day ${lastClaimDay}`;
  }
}

async function getHoldingsTokenIds(sender: string): Promise<number[]> {
  const assetIdentifier = `${CONTRACT_ADDRESS}.${CONTRACT_NAME}::badge`;
  const res = await fetchJsonWithBackoff(
    `${STACKS_API_BASE}/extended/v1/tokens/nft/holdings?principal=${encodeURIComponent(sender)}&limit=200&offset=0`
  );
  if (!res.ok) return [];
  const body: unknown = await res.json();
  const results = Array.isArray((body as { results?: unknown }).results)
    ? ((body as { results: unknown[] }).results as unknown[])
    : [];

  const tokenIds: number[] = [];
  for (const row of results) {
    const r = row as { asset_identifier?: unknown; value?: unknown; token_id?: unknown };
    if (r.asset_identifier !== assetIdentifier) continue;

    const v = r.value ?? r.token_id;
    let tokenId: number | null = null;

    if (typeof v === "string") {
      const m = v.match(/^u(\d+)$/);
      if (m?.[1]) tokenId = Number(m[1]);
      else if (/^\d+$/.test(v)) tokenId = Number(v);
    } else if (typeof v === "object" && v !== null && "hex" in (v as Record<string, unknown>)) {
      const hex = (v as { hex?: unknown }).hex;
      if (typeof hex === "string") {
        try {
          const cv = hexToCV(hex);
          const val = cvToValue(cv) as unknown;
          if (typeof val === "bigint") tokenId = Number(val);
          else if (typeof val === "number") tokenId = val;
        } catch {
          // ignore
        }
      }
    }

    if (tokenId && Number.isFinite(tokenId)) tokenIds.push(tokenId);
  }

  return tokenIds;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function buildSnapshot(sender: string | null): Promise<OnChainSnapshot> {
  const caller = CONTRACT_ADDRESS;

  const contractOwnerPromise = getContractOwner();

  const [milestonesValue, infernoFeeValue, stormFeeValue, infernoUriValue, stormUriValue, currentDayValue] =
    await Promise.all([
      callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-milestones",
        functionArgs: [],
        senderAddress: caller,
      }).catch(() => null),
      callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-mint-fee-kind",
        functionArgs: [uintCV(INFERNO_KIND)],
        senderAddress: caller,
      }).catch(() => null),
      callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-mint-fee-kind",
        functionArgs: [uintCV(STORM_KIND)],
        senderAddress: caller,
      }).catch(() => null),
      callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-badge-uri",
        functionArgs: [uintCV(INFERNO_KIND)],
        senderAddress: caller,
      }).catch(() => null),
      callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-badge-uri",
        functionArgs: [uintCV(STORM_KIND)],
        senderAddress: caller,
      }).catch(() => null),
      callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-current-day",
        functionArgs: [],
        senderAddress: caller,
      }).catch(() => null),
    ]);

  const milestones =
    Array.isArray(milestonesValue)
      ? milestonesValue
          .map((v) => toNum(v))
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
      : null;

  const infernoFeeUstx = toNum(infernoFeeValue);
  const stormFeeUstx = toNum(stormFeeValue);
  const infernoUri = typeof infernoUriValue === "string" ? infernoUriValue : null;
  const stormUri = typeof stormUriValue === "string" ? stormUriValue : null;
  const currentDay = toNum(currentDayValue);

  const badgeUrisEntries = await Promise.all(
    BADGE_MILESTONE_KINDS.map(async (kind) => {
      const v = await callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-badge-uri",
        functionArgs: [uintCV(kind)],
        senderAddress: caller,
      }).catch(() => null);
      return [kind, typeof v === "string" ? v : null] as const;
    })
  );
  const badgeUris: Record<number, string | null> = {};
  for (const [k, u] of badgeUrisEntries) badgeUris[k] = u;

  let streak: number | null = null;
  let lastClaimDay: number | null = null;
  let lastClaimLabel = "—";
  let canClaim: boolean | null = null;
  let badgeSupport: BadgeSupport = null;
  let hasBadge: boolean | null = null;
  let badgeStatus: Record<number, boolean> = {};
  let badgeTokenIds: Record<number, number | null> = {};
  let collectiblesTokenInfo: TokenInfo[] = [];

  if (sender) {
    const [streakValue, lastDayValue] = await Promise.all([
      callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-streak",
        functionArgs: [principalCV(sender)],
        senderAddress: caller,
      }).catch(() => null),
      callReadOnly({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-last-claim-day",
        functionArgs: [principalCV(sender)],
        senderAddress: caller,
      }).catch(() => null),
    ]);

    streak = toNum(streakValue);
    lastClaimDay = toNum(lastDayValue);
    lastClaimLabel = await resolveLastClaimLabel(lastClaimDay);
    if (typeof currentDay === "number" && typeof lastClaimDay === "number") {
      // `get-last-claim-day` defaults to u0, so treat (streak=0,lastClaimDay=0) as "never claimed".
      const neverClaimed = streak === 0 && lastClaimDay === 0;
      canClaim = neverClaimed ? true : currentDay > lastClaimDay;
    }

    const kindsToCheck = BADGE_MILESTONE_KINDS;

    try {
      const hasResults = await Promise.all(
        kindsToCheck.map(async (kind) => {
          const v = await callReadOnly({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "has-badge-kind",
            functionArgs: [principalCV(sender), uintCV(kind)],
            senderAddress: caller,
          });
          return [kind, Boolean(v)] as const;
        })
      );

      badgeSupport = "v2";
      badgeStatus = Object.fromEntries(hasResults) as unknown as Record<number, boolean>;

      const tokenIdPairs = await Promise.all(
        hasResults.map(async ([kind, has]) => {
          if (!has) return [kind, null] as const;
          const tokenValue = await callReadOnly({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "get-badge-token-id",
            functionArgs: [principalCV(sender), uintCV(kind)],
            senderAddress: caller,
          }).catch(() => null);
          return [kind, toNum(tokenValue)] as const;
        })
      );
      badgeTokenIds = Object.fromEntries(tokenIdPairs) as unknown as Record<number, number | null>;

      hasBadge = Boolean(badgeStatus[7]);
    } catch {
      try {
        const v = await callReadOnly({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "has-badge",
          functionArgs: [principalCV(sender)],
          senderAddress: caller,
        });
        badgeSupport = "v1";
        hasBadge = Boolean(v);
        badgeStatus = { 7: Boolean(v) };
        badgeTokenIds = {};
      } catch {
        badgeSupport = null;
        hasBadge = null;
        badgeStatus = {};
        badgeTokenIds = {};
      }
    }

    const tokenIds = await getHoldingsTokenIds(sender);
    if (tokenIds.length > 0) {
      const tokenInfo = await mapLimit(tokenIds, 5, async (tokenId) => {
        const [kindValue, uriValue] = await Promise.all([
          callReadOnly({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "get-badge-kind",
            functionArgs: [uintCV(tokenId)],
            senderAddress: caller,
          }).catch(() => null),
          callReadOnly({
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
            functionName: "get-token-uri",
            functionArgs: [uintCV(tokenId)],
            senderAddress: caller,
          }).catch(() => null),
        ]);

        const kindNum = toNum(kindValue);
        const metadataUri = typeof uriValue === "string" ? uriValue : null;
        return { tokenId, kind: kindNum, metadataUri };
      });

      const badgeKinds = new Set<number>(BADGE_MILESTONE_KINDS);
      const badgeTokenIdSet = new Set<number>(
        Object.values(badgeTokenIds).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      );
      const badgeUriSet = new Set<string>(
        Object.values(badgeUris).filter((v): v is string => typeof v === "string" && v.length > 0)
      );

      collectiblesTokenInfo = tokenInfo.filter((info) => {
        if (badgeTokenIdSet.has(info.tokenId)) return false;
        if (info.kind !== null && badgeKinds.has(info.kind)) return false;
        if (info.metadataUri && badgeUriSet.has(info.metadataUri)) return false;
        return true;
      });
    }
  }

  return {
    contractOwner: await contractOwnerPromise,
    milestones,
    badgeUris,
    infernoFeeUstx,
    infernoUri,
    stormFeeUstx,
    stormUri,
    currentDay,
    streak,
    lastClaimDay,
    lastClaimLabel,
    canClaim,
    badgeSupport,
    hasBadge,
    badgeStatus,
    badgeTokenIds,
    collectiblesTokenInfo,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

type PagesContext = {
  request: Request;
  env: Env & Record<string, unknown>;
  waitUntil(promise: Promise<unknown>): void;
};

export const onRequestGet = async (context: PagesContext) => {
  const url = new URL(context.request.url);
  const senderParam = (url.searchParams.get("sender") || "").trim();
  const sender = senderParam.length > 0 ? senderParam : null;
  const force = url.searchParams.get("force") === "1";

  const commit = context.env.CF_PAGES_COMMIT_SHA;
  const ns = typeof commit === "string" && commit.length > 0 ? commit : "dev";

  const cacheKey = `onchain:${ns}:${STACKS_NETWORK}:${CONTRACT_ADDRESS}.${CONTRACT_NAME}:${sender ?? "global"}`;

  try {
    if (!force) {
      const cached = await getCacheJson<OnChainSnapshot>(context.env.DB, cacheKey);
      if (cached.hit) {
        const resp: ApiResponse = {
          ok: true,
          cached: true,
          fetchedAt: Date.now(),
          data: cached.value,
        };
        return jsonResponse(resp);
      }
    }

    // Best-effort cleanup.
    context.waitUntil(purgeExpired(context.env.DB));

    const data = await buildSnapshot(sender);
    const ttlSeconds = sender ? 60 * 60 : 60 * 60 * 24;
    await setCacheJson(context.env.DB, cacheKey, data, ttlSeconds);

    const resp: ApiResponse = { ok: true, cached: false, fetchedAt: Date.now(), data };
    return jsonResponse(resp);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const resp: ApiResponse = { ok: false, error: message };
    return jsonResponse(resp, 500);
  }
};
