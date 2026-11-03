# Security model and limitations

Agentra is an initial implementation, not an independently audited payment system. Review the actual code, deployment configuration, test output, and external dependencies before using real funds.

## Wallet authority

Wallet connection exposes a public address. Signing in proves control of that address for a short-lived application session; it does not grant spending permission. Every paid request requires a separate x402 payment authorization through the buyer's wallet. The current SIWE verifier supports EOA signatures; EIP-1271 smart-contract-account login is not implemented. Agentra stores no seed phrase, private key, unrestricted signing credential, or persistent delegated-spending key. Do not paste these into chat, forms, or environment settings.

An x402 authorization is a real asset-transfer authorization. Always inspect the network, recipient, token, amount, and expiration in the application and wallet. Testnet and mainnet USDC are different assets.

## Application boundaries

- Server-side session ownership checks protect user-specific records. Administrative actions require an administrative role.
- SIWE authentication must bind the signed message to the expected origin, chain, nonce, and expiry, then consume the nonce and create an expiring httpOnly session.
- Input validation, body limits, endpoint restrictions, and rate limits reduce abuse. They do not replace production capacity planning or a distributed abuse-control service.
- Provider listings enter a curated review path. The server must never fetch arbitrary submitted URLs, private-network addresses, or redirect targets. A submitted listing does not prove endpoint control or contractual correctness. Operators verify the supplied ownership token at `/.well-known/agentra-verification.txt` and test the response contract independently before recording evidence and approving a listing. The initial paid gateway does not proxy external providers.
- Reference services operate only on submitted data. They do not execute arbitrary provider code, browse arbitrary URLs, or give a model discretion to add paid tools.
- Workflows are one to three steps, sequential, fixed in advance, and separately authorized per payment. Steps choose static inputs or an approved deterministic previous-output mapping. Text mappings use the prior summary text (or JSON output); numeric mappings accept an extracted nonempty numeric array. Extraction schemas and sentence limits stay as approved; incompatible output is rejected before requesting another payment. Approval expires after one hour. A budget is a limit, not delegated authority.

## Payment integrity

The backend must use official x402 requirements and server-side facilitator verification/settlement rather than trusting a browser success flag. Exact USDC integer units are used for settlement. Retain payer, recipient, network, amount, authorization, execution, and transaction evidence for reconciliation.

Idempotency keys identify an execution and should be retained by clients for recovery. Do not change a request body or user identity while reusing a key. If a settlement response is lost or ambiguous, reconcile its durable state and onchain evidence before initiating a new payment. Automatic reconciliation is limited to a known transaction hash; if the facilitator did not return a hash, operator intervention is required. The app must not retry an ambiguous payment as if it had never been submitted. A successful settlement followed by a service failure does not automatically mean the buyer has received a refund.

The initial implementation does not promise automatic refunds. Operators must define support and refund procedures and verify any refund transaction separately. Never fabricate a refund receipt or delete auditable payment history to conceal a failure.

## Production work

Before public production use, review concurrency and replay defenses across multiple application instances, distributed rate limiting, RPC and facilitator timeouts, ambiguous-settlement recovery, session lifecycle, logs and secret redaction, database access, backup/restore, abuse handling, and monitoring. Ensure external endpoint control and response contracts are verified before approval.

Run an independent security assessment. Testnet success does not establish mainnet readiness, and a local suite cannot certify every wallet or facilitator. Track unverified integrations explicitly rather than presenting them as working guarantees.
