"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Bot, Braces, Check, CheckCircle2, Code2, Copy, FileJson, KeyRound, Plus, ShieldCheck, Terminal, Wallet, Zap } from "lucide-react";
import { AppShell, Badge, EmptyState, PageHeading } from "@/components/ui";
import { useWallet } from "@/components/wallet-provider";
import { api, formatUsdc, type Agent } from "@/lib/client";
import { BASE_CONFIG, BUILDER_CODE, SUPPLIED_ATTRIBUTION_REFERENCE } from "@/lib/chain";

function Code({ children, label = "TERMINAL" }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="docs-code"><div className="inline spread"><span className="eyebrow">{label}</span><button className="icon-button" aria-label="Copy code example" onClick={() => { void navigator.clipboard.writeText(children); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div><pre className="code-block">{children}</pre></div>;
}

const discoveryCode = `curl http://localhost:3000/api/agents`;
const previewCode = `curl -X POST http://localhost:3000/api/preview/summary \\
  -H 'Content-Type: application/json' \\
  -d '{"input":{"text":"Base is an Ethereum layer 2 network. Agentra connects useful services through explicit USDC payments."}}'`;
const unpaidCode = `curl -i -X POST http://localhost:3000/api/services/summary \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: my-unique-task-001' \\
  -d '{"input":{"text":"Your passage to summarize."}}'`;
const authCode = `import { createSiweMessage } from "viem/siwe";

// Trigger only when the user clicks Sign in.
const challenge = await fetch("/api/auth/nonce", {
  credentials: "same-origin",
}).then(response => response.json());
const [address] = await walletClient.getAddresses();
const message = createSiweMessage({
  domain: challenge.domain,
  uri: challenge.uri,
  chainId: challenge.chainId,
  address,
  version: "1",
  nonce: challenge.nonce,
  issuedAt: new Date(),
  statement: "Sign in to Agentra. This does not authorize payments.",
});
const signature = await walletClient.signMessage({ account: address, message });
const response = await fetch("/api/auth/verify", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, signature }),
});
if (!response.ok) throw new Error("Wallet sign-in failed.");`;
const clientCode = `import {
  fetchPaymentQuote,
  authorizeAndExecute,
} from "@/lib/wallet-payment";

// A valid SIWE session for the payment wallet is required.
const session = await fetch("/api/session", {
  credentials: "same-origin",
}).then(response => response.json());
if (!session.user) throw new Error("Sign in with your wallet first.");

// Step 1: request and display the real price.
const quote = await fetchPaymentQuote(
  "summary",
  { text: "Your passage to summarize." },
  crypto.randomUUID(),
);

// Step 2: call only from an explicit approval action.
// walletClient is a connected viem browser WalletClient.
const receipt = await authorizeAndExecute(quote, walletClient, {
  onStatus: status => console.log(status),
});
console.log(receipt.result);`;

export function DeveloperPage() {
  const [active, setActive] = useState("start");
  useEffect(() => { const section = window.location.hash.slice(1); if (["start", "payments", "publish", "security"].includes(section)) setActive(section); }, []);
  const sections = [{ id: "start", title: "Getting started", icon: Terminal }, { id: "payments", title: "x402 payments", icon: Zap }, { id: "publish", title: "Publish a service", icon: Bot }, { id: "security", title: "Security & trust", icon: ShieldCheck }];
  return <AppShell><PageHeading eyebrow="BUILT FOR BUILDERS" title="Ship useful agents. Get paid for their work." description="An open API, official x402 payments, and a direct path from an idea to a service." actions={<Link href="/agents/new" className="button primary"><Plus size={16} />Register an agent</Link>} /><div className="docs-intro panel"><div className="docs-intro-icon"><Code2 size={33} /></div><div><div className="eyebrow">THE AGENTRA DEVELOPER PLATFORM</div><h2>Less payment plumbing. More possibility.</h2><p className="muted">Discover services with JSON. Test deterministic reference implementations for free. Pay for execution with the official x402 v2 protocol.</p></div><Badge tone="success">Base Sepolia first</Badge></div><div className="docs-tabs" role="tablist" aria-label="Developer guide">{sections.map(s => <button key={s.id} role="tab" aria-selected={active === s.id} onClick={() => setActive(s.id)} className={active === s.id ? "active" : ""}><s.icon size={17} />{s.title}</button>)}</div>
  {active === "start" && <section className="panel panel-body stack" role="tabpanel"><div className="inline"><span className="docs-step">01</span><div><p className="eyebrow">START WITH DISCOVERY</p><h2>Find the right tool for the task.</h2></div></div><p className="muted">The public discovery API lists actual database records, including prices in exact six-decimal USDC integer units, input schemas, and endpoint URLs. Browsing does not require a wallet.</p><Code>{discoveryCode}</Code><div className="inline"><span className="docs-step">02</span><div><p className="eyebrow">TRY A FREE PREVIEW</p><h2>Useful work before a wallet signature.</h2></div></div><p className="muted">Reference previews are free, size-limited, deterministic implementations. They do not produce a settlement receipt or count as paid executions.</p><Code>{previewCode}</Code><div className="grid-3"><div className="docs-feature"><FileJson size={23} /><h3>Text summary</h3><p className="muted">Extractive sentence selection and structured text metadata. No hidden model calls.</p><code>POST /api/preview/summary</code></div><div className="docs-feature"><Braces size={23} /><h3>Data analysis</h3><p className="muted">Calculate numerical statistics and report trends from a supported dataset.</p><code>POST /api/preview/analysis</code></div><div className="docs-feature"><Code2 size={23} /><h3>Structured extraction</h3><p className="muted">Extract permitted field types into validated structured output.</p><code>POST /api/preview/extraction</code></div></div><div className="notice">Examples target a local development server. Replace the origin with your deployed Agentra URL. Read each service&apos;s actual input schema before submitting data.</div><Link href="/marketplace" className="text-link">Explore service contracts <ArrowRight size={15} /></Link></section>}
  {active === "payments" && <section className="panel panel-body stack" role="tabpanel"><div className="inline"><span className="docs-step">01</span><div><p className="eyebrow">HTTP-NATIVE PAYMENTS</p><h2>A request. A quote. Your approval.</h2></div></div><p className="muted">Agentra uses official x402 v2 packages with the exact EVM scheme and EIP-3009 USDC authorization. Network identifiers use CAIP-2: <code>{BASE_CONFIG.network}</code>. The browser asks your wallet to sign only after you approve the displayed payment.</p><Code>{unpaidCode}</Code><p className="muted">A configured paid endpoint returns HTTP 402 with the official <code>PAYMENT-REQUIRED</code> header. The client SDK creates the <code>PAYMENT-SIGNATURE</code> header; a verified response includes <code>PAYMENT-RESPONSE</code>. Do not construct these headers manually.</p><h3>Authenticate the wallet before signing a payment</h3><p className="muted">Signed paid requests and recovery require a valid SIWE session for the same wallet that signs the USDC authorization. The nonce and session use HTTP-only cookies. The server also requires the request Origin to match the deployment&apos;s configured APP_URL.</p><Code label="TYPESCRIPT · BROWSER SIGN-IN">{authCode}</Code><p className="muted">Browser requests must come from the Agentra origin and retain same-origin cookies. An external client must fetch the nonce, sign the matching SIWE message, submit it to verify, and retain that cookie jar. For authenticated POST requests it must send the exact configured Origin. A payment signature alone does not create a session. Public discovery, free previews, and unsigned quotes remain available without sign-in.</p><Code label="TYPESCRIPT · EXPLICIT PAYMENT APPROVAL">{clientCode}</Code><div className="grid-2"><div className="docs-feature"><h3>Idempotency & recovery</h3><p className="muted">Use a unique Idempotency-Key for a new task. Keep the key and input unchanged when recovering the same request. Conflicting key reuse and reused payment proofs are rejected. Inspect durable execution records before retrying an uncertain settlement.</p></div><div className="docs-feature"><h3>Settlement evidence</h3><p className="muted">Service output is released after the facilitator settles and the server verifies a mined transfer from the configured official USDC token. Payment state and execution state are recorded separately.</p></div></div><div className="notice">Payments remain unavailable until the operator configures a recipient, a compatible facilitator, and RPC access. An unconfigured endpoint returns 503. No payment or attribution is claimed from a preview.</div><h3>Builder attribution</h3><dl className="detail-list"><div><dt>Application code</dt><dd><code>{BUILDER_CODE}</code></dd></div><div><dt>Supplied reference</dt><dd className="break-all"><code>{SUPPLIED_ATTRIBUTION_REFERENCE}</code></dd></div></dl><p className="muted">The app declares the supported x402 builder-code extension. The supplied suffix is preserved as a reference; it is never manually appended to a signed payment. Facilitator support and confirmed settlement calldata determine whether attribution is verified.</p><a href="https://github.com/coinbase/x402" className="text-link" target="_blank" rel="noreferrer">Official x402 SDK <ArrowUpRight size={14} /></a></section>}
  {active === "publish" && <section className="panel panel-body stack" role="tabpanel"><div className="inline"><span className="docs-step">01</span><div><p className="eyebrow">PROVIDER ONBOARDING</p><h2>A useful service deserves a clear contract.</h2></div></div><p className="muted">Connect your wallet and sign in with a nonce-based Sign-In with Ethereum message. This creates a short-lived account session; it does not grant payment permission.</p><div className="docs-feature"><h3>Prepare your listing</h3><ul className="docs-list"><li>A public HTTPS API endpoint with an accurate description.</li><li>JSON input and output schemas, plus valid examples.</li><li>A price in USDC and the recipient wallet you control.</li><li>Documentation explaining limits, expected outputs, and failure handling.</li></ul></div><div className="docs-feature"><h3>Verification before publication</h3><p className="muted">New provider submissions are stored as pending applications. An operator must verify endpoint ownership, review the request/response contract, and approve the provider domain. There is no automatic server-side fetch to an arbitrary submitted URL.</p></div><div className="notice">External services are curated directory listings in this MVP. The integrated paid gateway executes only the three application-owned reference services. Registering an external endpoint does not make it a supported paid Agent Chains step.</div><div className="inline"><Link href="/agents/new" className="button primary">Register your agent <ArrowRight size={16} /></Link><Link href="/developer/endpoints" className="button secondary">Manage your endpoints</Link></div><h3>Provider earnings</h3><p className="muted">USDC payments go to the displayed provider recipient. There is no platform fee in this MVP. Your dashboard counts only verified settlements. Failed execution after a settled payment does not automatically reverse that payment; contact the operator for reconciliation.</p></section>}
  {active === "security" && <section id="security" className="panel panel-body stack" role="tabpanel"><div className="inline"><ShieldCheck size={28} /><div><p className="eyebrow">CLEAR BOUNDARIES</p><h2>Designed for explicit permission.</h2></div></div><div className="grid-2"><div className="docs-feature"><Wallet size={24} /><h3>Wallets stay with their owners</h3><p className="muted">No private keys or seed phrases are stored. Every paid request needs an explicit signature. A connection or approved chain budget is never unrestricted spending permission.</p></div><div className="docs-feature"><KeyRound size={24} /><h3>Authentication is separate</h3><p className="muted">SIWE signatures are checked against a one-time nonce, configured origin, chain, and expiry. Server-side sessions protect private workspace and administrative routes.</p></div><div className="docs-feature"><ShieldCheck size={24} /><h3>Fixed Agent Chains</h3><p className="muted">At most three allowlisted services, fixed input templates or explicitly approved previous-output transforms, an overall budget, per-service caps, approved recipients, and expiring permission. Each payment is separately authorized.</p></div><div className="docs-feature"><CheckCircle2 size={24} /><h3>Honest records</h3><p className="muted">No fake balances, popularity scores, transaction hashes, or settlement events. Testnet and mainnet records remain distinct.</p></div></div><h3>Errors you should handle</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Response</th><th>Meaning</th><th>Next action</th></tr></thead><tbody><tr><td>400 / 422</td><td>Invalid request or unsupported input</td><td>Review the service schema</td></tr><tr><td>401 / 403</td><td>Missing session or permission</td><td>Sign in or use the correct account</td></tr><tr><td>402</td><td>Payment authorization required or invalid</td><td>Review official payment requirements</td></tr><tr><td>409</td><td>Conflicting request or payment state</td><td>Recover the existing execution</td></tr><tr><td>429</td><td>Rate limit</td><td>Wait before retrying</td></tr><tr><td>503</td><td>Required payment infrastructure unavailable</td><td>Retry after operator configuration</td></tr></tbody></table></div><div className="notice">This is an MVP, not a security certification. Mainnet requires explicit operator enablement, a production database, reliable RPC and facilitator access, and an independent security review.</div></section>}
  </AppShell>;
}

export function EndpointsPage() {
  const { user } = useWallet(); const [agents, setAgents] = useState<Agent[]>([]), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => { if (!user) return; setLoading(true); api<{ agents: Agent[] }>("/api/agents?mine=true").then(r => setAgents(r.agents)).catch(e => setError(e instanceof Error ? e.message : "Could not load endpoints.")).finally(() => setLoading(false)); }, [user]);
  return <AppShell><PageHeading eyebrow="DEVELOPER / ENDPOINTS" title="Your services, at a glance." description="Review published endpoints and track pending provider applications." actions={<Link href="/agents/new" className="button primary"><Plus size={16} />Register an endpoint</Link>} />{error && <div className="notice error" role="alert">{error}</div>}{!user ? <EmptyState title="Sign in to manage your endpoints." description="Connect your wallet and sign in from your wallet dashboard." action={<Link href="/wallet" className="button secondary">Open wallet <ArrowRight size={15} /></Link>} /> : loading ? <div className="panel panel-body muted">Loading endpoints…</div> : !agents.length ? <EmptyState title="Your first endpoint starts here." description="Publish a useful API contract with clear USDC pricing. Operator review keeps the marketplace curated." action={<Link href="/agents/new" className="button primary">Register your first agent <Plus size={16} /></Link>} /> : <div className="stack">{agents.map(a => <section className="panel panel-body stack" key={a.id}><div className="inline spread"><div className="inline"><div className="agent-avatar"><Bot size={23} /></div><div><h3>{a.name}</h3><p className="muted">{a.providerName} · {a.category}</p></div></div><Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>{a.status.toLowerCase()}</Badge></div><div className="endpoint-url"><span className="badge">POST</span><code>{a.endpointUrl}</code></div><dl className="detail-list"><div><dt>Price per call</dt><dd>{formatUsdc(a.priceUnits)} USDC</dd></div><div><dt>Recipient</dt><dd className="break-all"><code>{a.recipient}</code></dd></div><div><dt>Verified executions</dt><dd>{a.executionCount ?? 0}</dd></div></dl>{a.status === "ACTIVE" ? <Link href={`/agents/${a.id}`} className="text-link">View public service contract <ArrowUpRight size={15} /></Link> : <div className="notice">This listing is not publicly available. Endpoint ownership and API contract verification must be completed before approval.</div>}</section>)}</div>}<div className="panel panel-body"><h3>Need help publishing?</h3><p className="muted">Learn about input contracts, endpoint verification, payment boundaries, and integration testing.</p><Link href="/developer" className="text-link">Read the developer guide <ArrowRight size={15} /></Link></div></AppShell>;
}
