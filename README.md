# StackUp

Daily streaks on Stacks. Connect your wallet, claim once per day, and earn NFT badge milestones on-chain.

## What It Does
- `claim()` once per day to build a streak.
- If you miss a day, your streak resets to `1`.
- Badge NFTs are minted automatically at milestone streaks (V2 supports multiple milestones).

## Contracts
This repo contains two generations of the contract:
- `contracts/streak.clar` (V1): streak tracking + 7-day badge.
- `contracts/streak-v3.clar`: streak tracking + configurable badge milestones + token URIs for metadata.
- `contracts/streak-v3-1.clar`: redeploy name variant (when `streak-v3` is already taken).
- `contracts/streak-v3-2.clar`: redeploy name variant that also auto-mints the 1-day badge on the first claim (if `u1` URI is configured).
- `contracts/streak-v3-3.clar`: adds admin-configurable auto-mint milestones (`set-milestones`) + optional paid mint (`mint-paid-kind`) that accumulates fees in the contract (withdrawable).
- `contracts/streak-v3-4.clar`: same as v3-3, but paid mint fees go directly to a configurable `fee-recipient` wallet.

### Badge Metadata (IPFS)
V2 supports token metadata URIs via `set-badge-uri(kind, uri)`:
- Upload PNGs + metadata JSON files to IPFS (Pinata is fine).
- Set the `ipfs://...` metadata URI for each milestone kind (e.g. `3`, `7`, `14`, `30`).

Metadata templates live in `metadata/`.

## App
The frontend is a Next.js App Router project.

Features:
- Leather wallet connect
- Claim transaction flow (`openContractCall`)
- Read-only on-chain state (streak, last-claim day, badge status)
- Light / dark theme
- Badge gallery (3 / 7 / 14 / 30) + custom milestone check/mint UI (V2)

### Configuration (Frontend)
Set these Cloudflare Pages / local env vars:
- `NEXT_PUBLIC_STACKS_NETWORK` = `mainnet` or `testnet`
- `NEXT_PUBLIC_CONTRACT_ADDRESS` = `SP...` (mainnet) / `ST...` (testnet)
- `NEXT_PUBLIC_CONTRACT_NAME` = `streak`, `streak-v3`, `streak-v3-1`, `streak-v3-2`, `streak-v3-3`, or `streak-v3-4`

If env vars are not set, the app falls back to defaults inside `app/ClientPage.tsx`.

## Development
Requirements:
- Node.js + npm

Install + run:
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Scripts
```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
```

## Deploy (Cloudflare Pages)
This project is configured for static export.

Recommended Pages settings:
- Build command: `npm run build`
- Build output directory: `out`

`wrangler.toml` is included for Pages configuration.

## Brand Assets
- Logos: `public/logo/`
- Icons: `public/icons/`
- Badge images: `public/badges/`
