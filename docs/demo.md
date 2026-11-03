# Base ecosystem demo walkthrough

This walkthrough demonstrates implemented behavior and records real evidence. It is not a claim of live adoption, production deployment, or confirmed settlement before the steps have been run.

## Local product demo without funds

1. Start the app using `README.md` and seed the database.
2. Visit the landing page, then open the marketplace. Explain that the listings are three application-owned deterministic reference services, not third-party adoption.
3. Search for a summary service, open its detail page, inspect the input schema and price, then run its **free preview** with a paragraph. Explain why a free preview is separate from a paid execution.
4. Open data analysis and submit a numeric dataset. Inspect the actual statistics returned. Open structured extraction and use its documented supported schema.
5. Open the dashboard and transaction history. If there are no records, show the empty states; do not seed fabricated transactions or performance metrics.
6. Connect a compatible injected browser wallet and approve the login signature. Explain that login has no spending authority. Disconnect and confirm that authenticated pages no longer reveal private records.
7. Register a provider service. Demonstrate that it enters curated review rather than becoming an automatically trusted public paid endpoint.
8. Build a short Agent Chain using approved reference services. Inspect its fixed services, per-step price, and total budget before any payment.

## Funded Base Sepolia verification

Prerequisites: configure an owned payout address, a working Base Sepolia RPC and compatible facilitator, and a buyer wallet funded with official Base Sepolia USDC. The test is manual because the buyer must confirm in their own wallet. Never send private keys to the application or this chat.

1. Make an unpaid paid-service request and inspect its actual HTTP 402 requirements.
2. In the app, review the price, USDC token, network, recipient, and buyer address. Reject the first wallet authorization and confirm no successful execution is reported.
3. Repeat with deliberate authorization. Keep the idempotency key, execution identifier, payment response, and settlement transaction hash returned by the app.
4. Check the Base Sepolia explorer and match chain, official USDC contract, sender, recipient, and amount to the stored receipt. Only now describe that payment as confirmed.
5. Recover the original execution with its original idempotency key. Confirm it returns the same execution and does not authorize another payment.
6. Check builder-code facilitator support and decode the confirmed transaction using the procedure in `payments.md`. Only describe attribution as verified if the actual confirmed settlement carries `bc_lvlczcjt` correctly.
7. Run a short workflow. Approve each step separately, inspect each result, and confirm that a declined or failed step stops further execution.
8. Export transaction history and separate Base Sepolia activity from any future mainnet metrics.

## Evidence to retain

Record the deployed version/commit, test date, network, service identifiers, test outcomes, request IDs, settlement hashes, and attribution verification result. Do not retain seed phrases, private keys, session cookies, or raw secrets. Report skipped manual checks as unrun, not passed.
