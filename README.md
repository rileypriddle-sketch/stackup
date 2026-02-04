# StackUp Nice

StackUp Nice is a Stacks mainnet “Daily Streak + Badge” app. Users connect a Stacks wallet, claim once per day, and earn NFT badge milestones on-chain.

## Highlights
- Mainnet wallet connect and contract call flow
- Read-only streak + last-claim queries
- Polished UI with light/dark toggle
- Custom logo and app icons

## Tech Stack
- Next.js (App Router)
- TypeScript
- Stacks Connect + Stacks.js

## Local Development
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Contract Configuration
Update the contract details in `app/page.tsx`:
- `CONTRACT_ADDRESS`
- `CONTRACT_NAME`

## Project Scripts
```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Assets
Custom assets live in:
- `public/logo/logo.png`
- `public/icons/`

## Deployment
Build and start:
```bash
npm run build
npm run start
```

Deploy on your preferred platform (Vercel, Netlify, or a VPS).
