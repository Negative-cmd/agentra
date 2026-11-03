# AGENTRA

**Discover. Connect. Pay. Execute.**

Agentra is a Base-only service marketplace with three working reference services, wallet authentication, x402 USDC payment infrastructure, and explicit per-payment approval for short Agent Chains. Built with Next.js, React, TypeScript, PostgreSQL, Prisma, viem, and the official x402 SDK.

The reference services are deterministic utilities: extractive text summaries, numeric data analysis, and structured pattern extraction. They do actual work without a model API key. They are labeled reference services, rather than presented as model intelligence. Marketplace records and execution history come from the database; the app does not seed fake users, ratings, volume, or payment activity.

## Run locally

Prerequisites: Node.js 24, npm, PostgreSQL (or Docker for the included `db:local` helper), and an EOA account in a compatible injected browser wallet for wallet features. Smart-contract account login (EIP-1271) is not implemented in this MVP. A wallet is not needed to browse or run a free reference preview.

```sh
npm ci
cp .env.example .env
npm run db:local
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

If you already have PostgreSQL, set `DATABASE_URL` in `.env` and omit `db:local`. The development helper is not a production database. Migrations create the schema; seeding creates only the three real reference service listings. Re-running the seed must not create artificial payment activity.

For paid requests, set `PAYMENT_RECIPIENT` in `.env` to a nonzero wallet address you control, rerun `npm run db:seed` to refresh the reference listings, restart the app, and use a funded **Base Sepolia** buyer wallet with official testnet USDC. Until configured, free previews and browsing work, while paid execution reports the missing configuration. See [payments and builder attribution](docs/payments.md). Signed paid requests require the buyer's authenticated SIWE session and an `Origin` matching `APP_URL`; an anonymous x402 client can inspect the unpaid quote but cannot purchase without that session.

## What the app does

- Browse, search, filter, and compare service listings; inspect schemas, input examples, prices, and results.
- Run free deterministic previews separately from paid requests.
- Connect an EIP-1193 browser wallet, switch to the configured Base network, and sign a nonce-bound wallet login.
- Persist provider applications and service registrations for curated review; pending external endpoints are not executed automatically.
- Authorize individual x402 USDC payments through the buyer's own wallet; server-side verification and settlement control fulfillment.
- Retain execution/payment evidence and support recovery using an idempotency key.
- Build one-to-three-step workflows with fixed approved services, approved static inputs or deterministic prior-output mappings, a one-hour approval expiry, and spending limits; each paid step still requires explicit wallet approval. Optional mappings pass previous text into a text service or extracted numeric arrays into analysis; services and extraction fields remain fixed in advance.
- Show the connected user's records, transactions, workflow results, and actual aggregate metrics, with empty states when no activity exists.

Connecting or signing in does **not** authorize spending. Agentra does not store seed phrases, private keys, or delegated wallet credentials. This implementation does not give this chat assistant unrestricted signing authority.

## Configuration

Use [.env.example](.env.example) as a template. Keep local `.env` files out of version control.

In this managed cloud environment, Node.js 24 must honor the provided outbound proxy. Start the app with `NODE_USE_ENV_PROXY=1 npm run dev` or `NODE_USE_ENV_PROXY=1 npm run start`. This uses Node's supported proxy handling and keeps TLS verification enabled. A normal hosting platform without this proxy can use the standard commands above.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `APP_URL` | Exact application origin for authentication and state-changing requests. |
| `NEXT_PUBLIC_BASE_NETWORK` | `base-sepolia` by default; `base` selects Base mainnet. |
| `NEXT_PUBLIC_BASE_RPC_URL` | Browser RPC URL; never put a secret API key in a public variable. |
| `BASE_RPC_URL` | Server RPC override. |
| `ENABLE_MAINNET_PAYMENTS` | Must explicitly be `true` before mainnet payments can run. |
| `PAYMENT_RECIPIENT` | Provider-controlled payout address for reference services. |
| `X402_FACILITATOR_URL` | Compatible x402 facilitator; its actual network/scheme support is checked separately. |
| `ADMIN_WALLETS` | Comma-separated wallet addresses eligible for the admin role on their next sign-in. |
| `PROVIDER_ALLOWED_HOSTS` | Exact curated public provider hostnames eligible for manual approval. |

Mainnet is an explicit deployment decision, not a fallback for testnet failures. Do not change the network while retaining a misleading displayed price, recipient, or history context.

Your Base builder code is preserved exactly as `bc_lvlczcjt`. The supplied attribution reference is preserved exactly as `0x62635f6c766c637a636a740b0080218021802180218021802180218021`. The reference suffix is not blindly appended to payment authorizations. See the [attribution verification procedure](docs/payments.md).

## Try the API without a wallet

With the local app running, these commands discover listings and run a clearly free preview:

```sh
curl -s http://localhost:3000/api/agents
curl -s http://localhost:3000/api/preview/analysis \
  -H 'Content-Type: application/json' \
  -d '{"data":[12,18,24,30,36]}'
```

The analysis returns five observations with mean and median `24`. A preview does not create a payment receipt or paid-execution metric. Use `/api/services/analysis` for the payment-gated endpoint; see `docs/payments.md` for authenticated x402 client requirements.

## Development and verification

```sh
npm run test
npm run typecheck
npm run build
npm run start
```

Browser tests use a running local app and seeded database:

```sh
npx playwright install chromium
npm run test:e2e
```

Run browser/API tests against a **local development database only**: they create ephemeral EOA login sessions and clearly labeled pending QA registrations, then delete only those test records. They do not spend assets or fabricate settlements. The Playwright config uses system Chromium when available; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select another installed Chromium binary. Automated tests can exercise protocol validation and failure paths; a real settlement and attribution require a funded testnet wallet, a working RPC, and a compatible facilitator. Follow the [demo walkthrough](docs/demo.md) for manual verification, including wallet rejection and network mismatch.

## Project layout

```text
app/           Pages and API route handlers
components/    Shared application UI and wallet flows
lib/           Authentication, validation, services, persistence, payments
prisma/        PostgreSQL schema and migrations
scripts/       Database initialization and reference-service seed
tests/         Unit and browser checks
docs/          Payment, deployment, security, and demo guides
```

## Deployment and remaining checks

See [validation evidence](docs/validation.md), [deployment](docs/deployment.md), [security limitations](docs/security.md), and [payments](docs/payments.md) before exposing the app publicly. A successful local build is not deployment, a security certification, or proof of a successful onchain payment. External provider approval remains curated. External listings are directory entries; the paid execution gateway currently runs only the three reference services and does not proxy third-party endpoints. Real payment receipts appear only after verified settlement.

## Release materials

The professional product and submission brief is available as [Word](docs/AGENTRA_Product_and_Submission_Brief.docx) and [Markdown](docs/AGENTRA_Product_and_Submission_Brief.md). Vercel deployment configuration and a database health route are included. See [deployment instructions](docs/deployment.md) for the secure hosting configuration. Standard start commands now automatically honor the managed cloud proxy when present.
