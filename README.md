# StackUp

Daily streaks on Stacks. Connect your wallet, claim once per day, and earn NFT badge milestones on-chain.

## What It Does
- `claim()` once per day to build a streak.
- If you miss a day, your streak resets to `1`.
- Badge NFTs are minted automatically at milestone streaks (V2 supports multiple milestones).

## Contracts
This repo contains two generations of the contract:
- `contracts/streak.clar` (V1): streak tracking + 7-day badge.
- `contracts/streak-v2.clar` (V2): streak tracking + configurable badge milestones + token URIs for metadata.

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
- `NEXT_PUBLIC_CONTRACT_NAME` = `streak` or `streak-v2`

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
