# Deployment guide

Agentra runs as a Node.js Next.js application with a persistent PostgreSQL database. Deploy the app and database together; a filesystem snapshot of the development environment does not deploy the product.

## Prepare

1. Provision PostgreSQL and a database role with the required migration/application permissions. Use TLS according to the provider's verified connection instructions. Back up the database and test restoration.
2. Install the pinned Node dependencies with `npm ci`. Keep the committed lockfile and TLS/package-integrity checks enabled.
3. Configure server variables in the hosting platform, using `.env.example` and `README.md`. Set `APP_URL` to the exact public HTTPS origin. Configure a stable database URL and provider payout address. Never deploy the local database password or expose private credentials with `NEXT_PUBLIC_`.
4. Keep `NEXT_PUBLIC_BASE_NETWORK=base-sepolia` and `ENABLE_MAINNET_PAYMENTS=false` for the first deployment. Public variables are embedded in the browser build; rebuild when changing networks or public RPC settings.
5. Allow required outbound HTTPS access to the chosen Base RPC and x402 facilitator. Provider hosts require deliberate curated configuration, rather than blanket server-side fetch access.

## Build and launch

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
npm run test
npm run typecheck
npm run build
npm run start
```

Run migrations once per deployment using a controlled release step. Do not run development database helpers on a production host. The app requires persistent PostgreSQL; Next.js build outputs alone do not preserve provider, workflow, session, or payment records.

Place the app behind a TLS reverse proxy or a supported Node hosting platform. The process listens on the hosting platform's configured port. Configure health checks that verify the app and database; a listening port alone does not validate payment readiness.

## Verify on the deployed origin

- Browse the three seeded reference listings and run a free preview with a known input.
- Authenticate with a test wallet; verify wrong-domain, expired, and reused login challenges fail.
- Confirm a normal user cannot access admin data or alter other providers' listings.
- Confirm an unpaid request is gated and a malformed payment is rejected.
- Complete one authorized Base Sepolia payment, then compare the persisted receipt with its BaseScan transaction, chain, USDC contract, sender, recipient, and exact amount.
- Recover the same execution using its original idempotency key without paying twice.
- Verify builder-code support and actual transaction attribution as described in `payments.md`. Configuration alone is not evidence of attribution.
- Build a two-step workflow, reject one payment in the wallet, and confirm no unapproved later step runs.
- Check mobile navigation, keyboard operation, reduced motion, and useful failure messages.

## Before mainnet

Mainnet is not automatically enabled. Conduct an independent security review, exercise failure/recovery against the intended facilitator, establish provider support and refund procedures, monitor settlement reconciliation, and configure production rate limiting and logs. Confirm the financial accounting and data-retention model are appropriate for the deployed service.

Only after an explicit operational decision should the deployment select `base`, set `ENABLE_MAINNET_PAYMENTS=true`, use official Base-mainnet USDC, and rebuild the frontend. The user must still approve every payment. Never use production funds merely to test that a button works.

## Prepared Vercel release

The repository includes `vercel.json`, a Node.js 24 engine pin, a proxy-aware startup launcher, and `GET /api/health` (200 when PostgreSQL is reachable; 503 otherwise). Deployment credentials and a hosted database are not present in the build environment, so no public deployment is claimed.

Import the release branch from `Negative-cmd/agentra`. In Vercel, add a hosted PostgreSQL integration and store its `DATABASE_URL` securely. Configure these additional values:

```text
APP_URL=https://YOUR-ACTUAL-SITE.vercel.app
NEXT_PUBLIC_BASE_NETWORK=base-sepolia
NEXT_PUBLIC_BASE_RPC_URL=https://sepolia.base.org
BASE_RPC_URL=https://sepolia.base.org
ENABLE_MAINNET_PAYMENTS=false
PAYMENT_RECIPIENT=0x04bb515f28713c2bab0fc10dcb094478fd02ccb5
X402_FACILITATOR_URL=https://x402.org/facilitator
```

Use the actual assigned site origin for `APP_URL`; wallet authentication rejects a different origin. Run the migration and seed commands once against the intended hosted database through a secured release job or trusted local terminal, then deploy. Preview deployments should use their own database and matching origin. Do not put database passwords, private keys or hosting tokens in GitHub files or chat. No wallet private key is needed by this application.

Download the professional product and submission brief from `docs/AGENTRA_Product_and_Submission_Brief.docx`. Add a real deployed URL and confirmed transaction evidence to a submission only after those exist.
