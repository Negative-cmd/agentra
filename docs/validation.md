# Validation evidence

Validated in the prepared local workspace on **3 November 2026**. These results concern the application and local PostgreSQL instance; they do not establish public deployment, real asset settlement, or independent security certification.

| Check | Result |
| --- | --- |
| Unit suite | **42 passed**: reference services, validation, workflow policy, and payment protocol/security behavior. |
| PostgreSQL payment integration suite | **7 passed** with the real database and mocked facilitator/RPC responses. Exercises durable state, concurrency, recovery, and workflow accounting without broadcasting transactions. |
| Playwright suite against the production build | **21 passed**: 7 API integration checks, 7 desktop Chromium checks, and 7 mobile Chromium checks. |
| TypeScript | `npm run typecheck` passed. |
| Production runtime | The built application started locally and served the successful browser/API checks. |
| Runtime dependency audit | No vulnerabilities reported by the runtime-only dependency audit. This is not a security audit of the application. |
| Restored environment payment connectivity | Base Sepolia RPC and the facilitator respond successfully; the app reports supported v2 payments and advertised builder-code support. This is a capability check, not settlement evidence. |
| Browser diagnostics | No browser console errors or uncaught page errors on the landing page or marketplace at 1440-pixel desktop and 412-pixel mobile widths; no horizontal page overflow. |

Browser/API coverage includes database-backed discovery and filtering, genuine free service output, protected registration, pending-listing visibility, public-endpoint restrictions, fixed workflow budgets, nonce-bound wallet sessions, nonce replay, wrong domain, expired messages, cross-origin rejection, wrong network, admin restrictions, wallet rejection, and disconnect. An ephemeral test EOA signs only its local login message; the test provider cannot broadcast transactions or sign payment typed data. Precisely identified test users and pending registrations are removed after the suite.

## Repeat the checks

Use a local development database, apply migrations, seed the reference services, and start a production build in a separate terminal:

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
npm run test
npm run typecheck
npm run build
npm run start
```

Then run:

```sh
RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/payments-db.test.ts
npm run test:e2e
```

The Playwright configuration uses installed system Chromium when available; otherwise install Chromium using Playwright. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a different installed binary. API tests and cleanup enforce a loopback application/database host.

## Still requires external verification

- **Real Base Sepolia payment:** unrun without a funded buyer wallet, reachable RPC, and compatible facilitator. Mocked integration results are not onchain settlement evidence.
- **Builder attribution:** the exact builder code and supplied reference are preserved, and the official x402 extension is implemented. Attribution remains unverified until an actual confirmed settlement carries `bc_lvlczcjt` and its calldata is checked.
- **Public deployment:** unrun. No live public application URL is claimed.
- **Mainnet:** not authorized or validated; it remains behind explicit configuration and per-payment wallet authorization.
- **External providers:** curated directory listings only. The paid execution gateway runs the three application-owned reference services and does not proxy arbitrary third-party endpoints.
- **Independent review:** security certification, production load testing, operational refund procedures, and production monitoring remain separate work.

See [payments](payments.md) for the real-settlement procedure and [deployment](deployment.md) for release preparation.

## Shipping preparation update

On 3 November, the production build, 42 unit checks, 7 PostgreSQL payment integration checks, and 21 browser/API checks passed again. The release adds Node.js 24 startup with managed-proxy support, Vercel configuration, and a database health endpoint. The runtime dependency audit reported zero vulnerabilities. The build retains a viem/ox warning from an unused Tempo-chain dependency; Base flows passed the recorded checks. No real settlement was broadcast. Hosting and a persistent hosted database still require the owner’s account configuration.
