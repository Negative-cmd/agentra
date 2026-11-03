# Base USDC payments and builder attribution

Agentra uses official `@x402/core`, `@x402/evm`, and `@x402/extensions` **2.29.0**, protocol **v2**, CAIP-2 networks, and EIP-3009 USDC authorizations. A connected wallet grants no spending permission. Each purchase, including each Agent Chain step, requires a separately reviewed payment and browser-wallet signature. The application stores no seed phrase or private key and requests no unlimited ERC-20 allowance.

## Networks and configuration

| Setting | Development default | Production change |
|---|---|---|
| `NEXT_PUBLIC_BASE_NETWORK` | `base-sepolia` | `base` |
| Chain ID / CAIP-2 | `84532` / `eip155:84532` | `8453` / `eip155:8453` |
| Official USDC contract | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `PAYMENT_RECIPIENT` | A real provider-controlled address | A separately reviewed mainnet recipient |
| `ENABLE_MAINNET_PAYMENTS` | `false` | Must explicitly be `true` to accept mainnet payments |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` | A facilitator confirmed to support Base mainnet and chosen attribution |
| `NEXT_PUBLIC_BASE_RPC_URL` | `https://sepolia.base.org` | Suitable production Base RPC |
| `BASE_RPC_URL` | Falls back to public RPC | A suitable server-side RPC |

USDC contract/domain metadata is checked against the official x402 EVM SDK's Base default-asset implementation. Cross-check with [Circle contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) before production rollout. Testnet USDC is not production money. Prices and accounting use integer micro-USDC (six decimals); reference-service purchases have an additional $1 per-payment limit.

After setting or changing `PAYMENT_RECIPIENT`, run `npm run db:seed` to refresh the three application-owned listings. The API refuses payment if the listing and configured recipient differ. Missing recipient or missing explicit mainnet enable returns an honest 503 rather than fabricated payment terms.

For cloud execution, allow the configured facilitator and RPC hosts in environment settings. Draft configuration does not prove a running instance has those rules. After the environment was published on 2 November 2026, read-only checks confirmed Base Sepolia RPC access and the facilitator's advertised v2 exact-payment and builder-code support. The restored app's `/api/payment-config?check=1` also reports `facilitatorStatus: supported` and `builderCodeSupported: true`. In this Node.js 24 cloud runtime, start the app with `NODE_USE_ENV_PROXY=1 npm run start` (or `npm run dev`) so SDK requests use the supplied proxy. Browser wallets also need network access and official Base Sepolia USDC. No funded wallet was supplied, no assets were spent, and actual settlement and onchain attribution remain unverified.

## Implemented request flow

1. `POST /api/services/summary`, `/analysis`, or `/extraction` with JSON `{ "input": ... }` validates the service input before offering payment.
2. An unpaid, configured service returns **402**, a JSON `PaymentRequired` body, and the SDK-encoded **`PAYMENT-REQUIRED`** header.
3. The interface displays the actual quote's network, recipient, and exact price. Clicking the approval action asks the browser wallet to sign its bounded **TransferWithAuthorization** EIP-712 message.
4. The client submits the unchanged SDK payment payload in **`PAYMENT-SIGNATURE`**, plus a unique **`Idempotency-Key`**. Prices, token/domain, recipient, network, authorization expiry, signed amount, and resource are checked again server-side.
5. The buyer must have an active SIWE session matching the authorization's `from` address. The facilitator verifies the proof. A durable, unique execution and onchain authorization-nonce fingerprint are claimed in a database transaction before calling settlement.
6. For Agent Chains, the claim transaction locks the approved workflow and checks its expiry, step order, provider, exact resolved input, cap, total reserved/spent budget, and single-use step permission.
7. The server calls the official core SDK's `settlePayment` **before** fulfilling the service. This application uses the core directly instead of the Next wrapper's normal settle-after-handler behavior to meet this requirement.
8. The returned real transaction reference is persisted. The server independently checks a successful Base receipt, an exact official-USDC `Transfer`, and the corresponding `AuthorizationUsed` event for this buyer and nonce. Only then does it record **SETTLED**, earnings, and run the deterministic service.
9. The completed result and persisted receipt are returned with SDK-encoded **`PAYMENT-RESPONSE`**. History and analytics count actual persisted confirmed settlements, never clicks or unverified client flags.

The three reference services perform deterministic local work. Their public test endpoints are explicitly free reference tests; the production purchase endpoints always enforce the paid flow. Do not describe deterministic extractive summarization as a hosted language model.

### Quote example (no payment)

```bash
curl -i http://localhost:3000/api/services/summary \
  -H 'Content-Type: application/json' \
  --data '{"input":{"text":"Base enables onchain applications. Agentra connects useful paid services."}}'
```

### Browser purchase example

The app already implements this sequence in the agent detail and workflow interfaces. `walletClient` must be a viem client for the buyer's injected wallet; do not send private keys to Agentra.

```ts
import { fetchPaymentQuote, authorizeAndExecute } from '@/lib/wallet-payment';

// Buyer first connects and signs in with SIWE in the application.
const quote = await fetchPaymentQuote(
  'summary',
  { text: 'Text supplied by the buyer.' },
  crypto.randomUUID(),
);
// Render quote.amountUnits (six decimals), quote.recipient, and quote.network.
// Run the next line ONLY in the buyer's explicit Approve payment action.
const result = await authorizeAndExecute(quote, walletClient);
```

External agent clients must first establish the implemented SIWE session (`/api/auth/nonce`, `/api/auth/verify`), retain its secure session cookie, and send `Origin` equal to `APP_URL` for paid POSTs. An anonymous `@x402/fetch` request can discover a quote but cannot purchase through this MVP's session-scoped API. The official x402 client then creates its payload from the returned requirements using the client's own signer. Include the cookie, Origin, `PAYMENT-SIGNATURE`, and stable `Idempotency-Key` in the paid request. The server rejects a payer that differs from the session wallet. Do not run an auto-paying generic client without per-payment review and an appropriate spend policy.

## Recovery, failure, and refunds

- The authorization fingerprint derives from network + official token + authorizer + nonce. Changing signature bytes or optional envelope fields cannot evade its database uniqueness constraint.
- Same request key and same authenticated buyer/input recover the original execution. Reusing a key for different input is rejected. Concurrent duplicate claims cannot submit another settlement.
- The browser keeps pending task details and request keys in **sessionStorage** before submission, never signatures or private keys. The task text can be sensitive; clearing browser storage removes this local convenience, but the authenticated transaction history remains durable.
- `pendingPayments(address)` lists this browser session's pending tasks. `recoverPaidExecution({ service, input, workflowStepId?, idempotencyKey })` posts the same request **without signing**. The history interface can also recover from server records after a page closes.
- A saved transaction hash can be independently reconciled by repeating that same unsigned POST. Confirmed deterministic work can resume without another payment. Receipt finalization uses a row lock; provider earnings are idempotent.
- Facilitator/network timeout is an **indeterminate** result: settlement may already have occurred. The execution enters `SETTLEMENT_UNKNOWN`, retains its workflow reservation, and is never automatically charged again. The UI does not show success.
- If the facilitator completed but its response/hash never reached the application, an operator must reconcile the recorded buyer/nonce against chain data. No automatic nonce scan, background reconciliation worker, or refund mechanism is provided in this MVP. Do not authorize a new payment to work around an unknown one.
- Invalid input is rejected before settlement. If the deterministic service fails after a confirmed payment, the original receipt is retained and the execution is FAILED. Refunds require a manual provider review/transfer; the app does not promise automatic refunds.
- Each Agent Chain payment is separately approved. Cancellation blocks unclaimed steps, and cannot revoke a payment already signed and claimed for settlement. No delegated/background spending is implemented.

## Builder code: exact preservation and honest verification

Application builder code (unchanged):

```text
bc_lvlczcjt
```

Supplied encoded reference (unchanged):

```text
0x62635f6c766c637a636a740b0080218021802180218021802180218021
```

The supplied reference is the UTF-8 code plus length `0b`, schema byte **`00`**, and the ERC-8021 marker: a **Schema 0** reference. The current official x402 **builder-code extension uses Schema 2** CBOR for app (`a`), facilitator wallet (`w`), service (`s`), and optional settlement metadata (`m`). The supplied Schema 0 suffix is retained as a reference only. It is never appended to a payment signature, token authorization, or transaction by the application.

Agentra declares the supported server extension:

```ts
import { BUILDER_CODE, declareBuilderCodeExtension } from '@x402/extensions/builder-code';
extensions: { [BUILDER_CODE]: declareBuilderCodeExtension('bc_lvlczcjt') }
```

The official core SDK echoes the server's app code into the payment envelope, and the resource-server extension protects its ownership. A supporting **facilitator** encodes and appends the Schema 2 transaction suffix. Agentra does not append a suffix itself, so it cannot double-append it or corrupt signed USDC payloads. A facilitator that does not support `builder-code` may settle without attribution; the UI must not claim attribution merely because the quote contains the code.

`GET /api/payment-config?check=1` asks the facilitator for actual supported kinds/extensions when payments are configured. `builderCodeSupported: true` proves advertised capability, **not** a successful attributed settlement. The server independently fetches confirmed settlement calldata and parses it with `parseBuilderCodeSuffixFromCalldata`; only an actual parsed `a === 'bc_lvlczcjt'` is stored as attribution `verified` in that receipt's evidence. Otherwise evidence reports `not-confirmed`.

For a funded Base Sepolia manual test:

1. Confirm recipient, token, active network, facilitator, and RPC configuration; use only a small amount of official testnet USDC.
2. Call the capability check and verify `exact` v2 on `eip155:84532`; record whether the facilitator advertises `builder-code`.
3. Connect and SIWE-sign-in with the funded buyer wallet. Select a reference service and inspect its quote.
4. Explicitly authorize one small testnet payment. Inspect COMPLETED result and the actual receipt/hash in history.
5. Open the actual Base Sepolia explorer reference, inspect USDC transfer, and inspect stored receipt evidence. For independent attribution verification:

   ```ts
   import { parseBuilderCodeSuffixFromCalldata } from '@x402/extensions/builder-code';
   const tx = await publicClient.getTransaction({ hash: actualSettlementHash });
   const attribution = parseBuilderCodeSuffixFromCalldata(tx.input);
   if (attribution?.a !== 'bc_lvlczcjt') throw new Error('Builder attribution not verified');
   ```

6. Retry the original request key and confirm the same result/hash with no second transfer. Test a rejected wallet signature and wrong network separately; neither should create a settled record.

**No actual onchain settlement or builder attribution was verified during development.** The automated SDK/signature tests use ephemeral local test accounts and do not broadcast transactions. Database payment-flow integration tests explicitly mock facilitator/RPC responses; they do not demonstrate real chain payment.

Sources inspected for protocol-sensitive implementation: official published SDK 2.29.0 type declarations/source and [x402 Builder Code docs](https://github.com/x402-foundation/x402/blob/main/docs/extensions/builder-code.mdx). Additional operator references are [Base Builder Codes](https://docs.base.org/base-chain/quickstart/builder-codes) and the SDK's referenced [ERC-8021](https://eip.tools/eip/8021); those websites were not accessible through this session's runtime allowlist. The published x402 extension's Schema 2 implementation is the authority for this integration; do not reuse the provided Schema 0 reference as its settlement suffix.

## Automated checks

`npm test` runs protocol/policy unit tests and explicitly skips database integration unless enabled. With the local PostgreSQL database migrated and seeded, run:

```bash
RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/payments-db.test.ts
```

This suite uses real PostgreSQL uniqueness/transaction locks and mocked facilitator/RPC evidence. It checks unpaid 402 behavior, payer mismatch, invalid verification, one-settlement idempotency, replay rejection, ambiguous timeout retention, no output before independent verification, and concurrent original/recovery finalization. It never broadcasts a transaction.
