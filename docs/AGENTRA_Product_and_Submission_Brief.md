An open marketplace for useful agent services and wallet-authorized USDC commerce on Base.

Prepared for product review, deployment planning, and a Base ecosystem submission. Version 0.1.0 • 3 November 2026.

Delivery status: working local testnet MVP. Public hosting, a funded onchain settlement, and confirmed transaction attribution remain outstanding. This document does not represent a security certification or a claim of production adoption.

# 1. Executive overview

Agentra helps developers publish discoverable API services and helps buyers inspect their contracts, try reference implementations, and authorize individual USDC purchases. Its distinguishing feature is Agent Chains: short, deterministic workflows with fixed approved services, spending caps, and visible results.

The application includes a responsive marketplace, wallet authentication, persistent PostgreSQL records, three working reference services, official x402 payment integration, transaction history, a workflow builder, developer documentation, and restricted administration. Every payment remains under the buyer’s control.

# 2. What users can do

- Browse listings without a wallet; search, filter by category, compare per-call USDC prices, and inspect input/output schemas.

- Run a free reference preview. The result is explicitly identified as free and creates no paid receipt or artificial usage metric.

- Connect an injected EIP-1193 wallet, switch to Base Sepolia, inspect official USDC balance, and sign a nonce-bound login message.

- Review the exact price, network, recipient and service before authorizing a separate x402 payment.

- Register an agent as a provider. Applications remain pending until an administrator records endpoint-control and contract-review evidence.

- Create a one-to-three-step Agent Chain, fix its services and transformations, approve a budget, and authorize each step separately.

- Review durable payment/execution records, recover an existing request without a new payment, and follow actual settlement hashes in BaseScan.

# 3. Reference services

| Service | Actual behavior | Price per paid call |
| --- | --- | --- |
| Clarity • Text Summary | Frequency-ranked extractive summary of original sentences; not a hosted language model. | 0.001 USDC |
| Vector • Data Analysis | Statistics, population standard deviation, and first-to-last trends from numeric input. | 0.002 USDC |
| Prism • Structured Extraction | Validated pattern extraction of email addresses, URLs, numbers and ISO dates. | 0.001 USDC |

These are bounded deterministic utilities. They perform real computation without model credentials, arbitrary code execution, or external browsing. Public previews are free; the paid routes provide the same computation after verified settlement with a durable receipt.

# 4. Agent Chains and spending controls

A chain has at most three sequential steps. The buyer fixes the provider list, per-service cap, maximum total budget, execution count, input templates, and optional prior-output transformations. Approval expires after one hour.

STATIC uses an approved fixed input. PREVIOUS_TEXT passes the preceding summary text or serialized JSON into an approved text service. PREVIOUS_NUMBERS passes a validated extracted numeric array into analysis. The server recomputes and validates resolved input before claiming payment; incompatible data stops the step before charging.

The database serializes workflow reservations and records reserved versus spent integer units. Completed predecessors are required before later steps. Cancellation blocks unclaimed steps; it does not reverse a settlement already in progress. The application offers no recursive or model-selected paid tools and no delegated spending authority.

# 5. Base network and payment configuration

| Configuration | Value |
| --- | --- |
| Development network | Base Sepolia • chain ID 84532 • eip155:84532 |
| Official testnet USDC | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| Mainnet option | Base • chain ID 8453; requires explicit mainnet enable and separate validation |
| Receiving wallet | 0x04bb515f28713c2bab0fc10dcb094478fd02ccb5 |
| Payment protocol | Official x402 SDK 2.29.0 • protocol v2 • exact EIP-3009 USDC authorization |
| Default facilitator | https://x402.org/facilitator |

Amounts are stored as integer micro-USDC, with six decimals. Reference purchases also have a one-USDC per-payment safety ceiling. Testnet activity is kept separate from mainnet records. Connecting a wallet or signing in does not approve a purchase.

# 6. Builder code and encoded attribution reference

Application builder code, preserved exactly:

bc_lvlczcjt

Supplied encoded reference, preserved exactly:

0x62635f6c766c637a636a740b0080218021802180218021802180218021

The supplied reference uses ERC-8021 Schema 0. The current x402 builder-code extension uses Schema 2 encoding. Agentra retains the supplied reference as an exact reference and declares the app code through the official extension. It does not append the supplied suffix to a signed USDC payload or double-append transaction calldata.

Read-only checks confirmed that the configured facilitator advertises Base Sepolia v2 exact payments and builder-code support. This establishes capability only. Following a real confirmed settlement, the server reads the transaction calldata and records attribution as verified only when the parsed app code equals bc_lvlczcjt. No actual attributed settlement has yet been demonstrated.

# 7. Payment lifecycle and recovery

- Validate the input and return an official HTTP 402 challenge with the PAYMENT-REQUIRED header.

- Display the exact quote and request the buyer’s explicit wallet authorization.

- Verify unchanged payment terms, session identity, official token, amount, recipient, resource, expiry, and authorization nonce.

- Claim a unique execution/idempotency key and authorization identity in PostgreSQL before settlement.

- Submit settlement with the official SDK, persist its transaction reference, and independently verify the successful USDC Transfer and AuthorizationUsed nonce events.

- Fulfill the deterministic service only after verified payment, then return the result and SDK PAYMENT-RESPONSE receipt.

- Recover the same request without signing again. Ambiguous settlements retain their reservation and require reconciliation; they are never automatically resubmitted.

If the facilitator’s response and transaction hash are lost, an operator must reconcile the recorded buyer and nonce. Automatic refunds and a background nonce-reconciliation worker are not implemented. Failed fulfillment after a settled payment retains the receipt and requires provider support.

# 8. Architecture and persistence

| Layer | Implementation |
| --- | --- |
| Application | Next.js App Router, React, TypeScript and responsive custom UI |
| Wallet and protocol | viem, EIP-1193 wallet interface, SIWE authentication, official x402 SDK |
| Persistence | PostgreSQL with Prisma models and driver adapter |
| Migrations | Version-controlled SQL; atomic checksummed runner with advisory locking |
| Validation | Zod contracts, bounded bodies, service registry and fixed workflow transforms |
| Verification | Vitest, real-database integration, Playwright desktop/mobile and API checks |

Data models cover users, wallet identities, sessions/nonces, providers, categories, agents and endpoints, payment requirements/authorizations/transactions, executions and steps, workflows and steps, earnings, and audit logs. Ownership checks scope private records to their authenticated users. Financial evidence is retained rather than replaced with browser-generated success flags.

# 9. Application and API map

| Area | Routes |
| --- | --- |
| Discovery | /, /marketplace, /agents/[id] |
| Provider workspace | /agents/new, /my-agents, /developer/endpoints |
| Buyer workspace | /dashboard, /wallet, /transactions |
| Workflows | /workflows, /workflows/[id] |
| Documentation and operations | /developer, /settings, /admin |
| Discovery and authentication API | /api/agents, /api/agents/[id], /api/auth/nonce, /api/auth/verify, /api/auth/logout, /api/session |
| Services and execution API | /api/preview/[service], /api/services/[service], /api/executions/by-key |
| Operations API | /api/workflows, /api/workflows/[id], /api/admin, /api/admin/analytics, /api/payment-config, /api/health |

# 10. Security boundaries and current limits

- Short-lived httpOnly sessions use nonce-based, origin- and network-bound signature verification. The MVP supports EOA login; EIP-1271 smart-account login remains future work.

- No seed phrases, private keys, unlimited allowances, or unrestricted signing credentials are stored by Agentra.

- External provider listings are curated directory entries. The current paid gateway executes only the three application-owned services and does not proxy third-party endpoints.

- Administration requires a configured administrative wallet. Submitted endpoint URLs are not automatically fetched, preventing arbitrary registration-driven server requests.

- Per-process abuse controls are present; a public deployment still requires shared rate limiting, monitoring, backups, operator procedures, and independent review.

- No public deployment, funded settlement, production transaction volume, verified user adoption, or security certification is claimed.

# 11. Verification evidence

| Check | Evidence |
| --- | --- |
| Unit tests | 42 passing service, validation, workflow and payment-policy checks |
| Database payment integration | 7 passing checks against real PostgreSQL; facilitator/RPC responses explicitly mocked |
| Browser/API integration | 21 passing checks across API, desktop and mobile projects |
| Build and types | Production compilation and TypeScript checks passed |
| Live connectivity | Base Sepolia RPC responds; facilitator advertises v2 exact and builder-code support |
| Not yet verified | Public deployment; a funded real USDC settlement; actual transaction attribution |

Automated test identities and pending registrations are removed after execution. The database is not seeded with fabricated payment activity, grant metrics, ratings, or user adoption. See docs/validation.md for commands and the current test record. A dependency audit is not an application security certification.

# 12. Deployment and operation

The release includes vercel.json for a Next.js deployment and an operational database health route. Node.js 24 is pinned. Standard start commands automatically honor the managed cloud proxy when present, preserving TLS verification. A public deployment needs a persistent hosted PostgreSQL database and a connected hosting account; neither is currently configured here.

- Import the release branch into Vercel or another Node.js host and provision a persistent PostgreSQL database.

- Enter DATABASE_URL securely in the hosting platform. Set APP_URL to the exact HTTPS site origin, NEXT_PUBLIC_BASE_NETWORK=base-sepolia, ENABLE_MAINNET_PAYMENTS=false, and the supplied PAYMENT_RECIPIENT.

- Set the facilitator and public/server RPC URLs. Configure ADMIN_WALLETS only for authorized operators. Never enter a private key or seed phrase.

- Run npm ci, npm run db:generate, npm run db:migrate, and npm run db:seed against the intended database before launch. Build with npm run build.

- Check /api/health, discovery, free preview, wallet login, and /api/payment-config?check=1 on the deployed origin.

- Using a funded Base Sepolia buyer wallet, explicitly approve one small payment; inspect the actual receipt, USDC transfer, nonce, and builder attribution before claiming payment readiness.

# 13. Submission-ready product description

AGENTRA is a Base-focused agent-service marketplace that combines discoverable API contracts, explicit USDC payment authorization, and budgeted multi-agent workflows. Its testnet MVP provides three useful deterministic reference services, an official x402 v2 payment path, wallet-based authentication, auditable payment/execution records, and short Agent Chains that preserve buyer control over each service and payment. The interface is responsive across desktop and mobile, and automated checks cover service behavior, authentication, payment policy, concurrency, recovery, and workflow limits.

Stage: working testnet-oriented MVP awaiting public deployment and funded end-to-end payment validation. Testnet activity must not be represented as production adoption. Public URL and actual settlement evidence should be added to the submission after they exist.

# 14. Suggested demonstration

- Open the marketplace; inspect a service’s real schema and published price.

- Run a free analysis preview on [12,18,24,30,36] and show mean 24.

- Connect a wallet, switch to Base Sepolia, and sign in. Explain that login does not authorize spending.

- Review and explicitly approve one test-USDC service purchase, then show its result and actual receipt.

- Open the confirmed transaction and stored attribution evidence; claim successful attribution only if it is verified.

- Create a short chain with a fixed prior-output transform and demonstrate the budget and per-step approval controls.

Supporting material: README.md; docs/payments.md; docs/security.md; docs/deployment.md; docs/validation.md; docs/demo.md. Professional product document prepared from the implemented code and recorded validation evidence.
