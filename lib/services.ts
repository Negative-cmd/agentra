import { z } from "zod";

export const serviceKinds = ["summary", "analysis", "extraction"] as const;
export type ServiceKind = (typeof serviceKinds)[number];

const passage = z.string().trim().min(1).max(40_000);
const fieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/)
  .refine((value) => !["constructor", "prototype", "__proto__"].includes(value), "Reserved field name");
const observation = z.number().min(-1e15).max(1e15);
const row = z.record(fieldName, observation).refine(
  (value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 50,
  "Each row must have between 1 and 50 numeric columns",
);

export const serviceInputSchemas = {
  summary: z.object({ text: passage, maxSentences: z.number().int().min(1).max(5).optional() }).strict(),
  analysis: z.object({ data: z.union([
    z.array(observation).min(1).max(1_000),
    z.array(row).min(1).max(1_000),
  ]) }).strict(),
  extraction: z.object({
    text: passage,
    schema: z.record(fieldName, z.enum(["emails", "urls", "numbers", "dates"])).refine(
      (value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 16,
      "Choose between 1 and 16 extraction fields",
    ),
  }).strict(),
};

export function validateServiceInput(kind: ServiceKind, input: unknown) {
  return serviceInputSchemas[kind].parse(input);
}

const stopWords = new Set(
  "a an and are as at be been but by can for from had has have he her his i if in into is it its may more not of on or our she than that the their them there they this to was we were will with you your".split(" "),
);

function words(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function summarize(input: z.infer<typeof serviceInputSchemas.summary>) {
  const source = input.text.match(/[^.!?\n]+(?:[.!?]+|(?=\n)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [input.text];
  const sentences = [...new Set(source)];
  const frequency = new Map<string, number>();
  for (const word of words(input.text)) {
    if (!stopWords.has(word)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  const selected = sentences.map((sentence, index) => {
    const tokens = words(sentence).filter((word) => !stopWords.has(word));
    const score = tokens.reduce((sum, word) => sum + (frequency.get(word) ?? 0), 0) / Math.sqrt(Math.max(1, tokens.length));
    return { sentence, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, input.maxSentences ?? 3).sort((a, b) => a.index - b.index);

  return {
    mode: "deterministic-reference" as const,
    method: "Frequency-ranked extractive summary; sentences are quoted from your passage.",
    summary: selected.map((item) => item.sentence).join(" "),
    sentences: selected.map((item) => item.sentence),
    sourceSentenceCount: source.length,
    sourceWordCount: words(input.text).length,
  };
}

function statistics(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const count = values.length;
  const sum = values.reduce((total, value) => total + value, 0);
  const mean = sum / count;
  const middle = Math.floor(count / 2);
  const median = count % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const first = values[0];
  const last = values[count - 1];
  const change = last - first;
  return {
    count, sum, mean, median, min: sorted[0], max: sorted[count - 1],
    standardDeviation: Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / count),
    first, last, change,
    changePercent: first === 0 ? null : change / Math.abs(first) * 100,
    trend: change > 0 ? "increasing" : change < 0 ? "decreasing" : "flat",
  };
}

function analyze(input: z.infer<typeof serviceInputSchemas.analysis>) {
  const columns = new Map<string, number[]>();
  if (typeof input.data[0] === "number") {
    columns.set("value", input.data as number[]);
  } else {
    for (const record of input.data as Record<string, number>[]) {
      for (const [key, value] of Object.entries(record)) {
        const values = columns.get(key) ?? [];
        values.push(value);
        columns.set(key, values);
      }
    }
  }
  return {
    mode: "deterministic-reference" as const,
    method: "Population statistics; trend compares the first and last observations in the supplied order.",
    rowCount: input.data.length,
    columns: Object.fromEntries([...columns].map(([name, values]) => [name, statistics(values)])),
    insights: [...columns].map(([name, values]) => {
      const result = statistics(values);
      return `${name}: ${result.count} observations, mean ${Number(result.mean.toPrecision(8))}, ${result.trend} from first to last.`;
    }),
  };
}

function unique<T>(values: T[]) { return [...new Set(values)]; }

function extract(input: z.infer<typeof serviceInputSchemas.extraction>) {
  const extractors = {
    emails: () => unique(input.text.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g) ?? []),
    urls: () => unique((input.text.match(/https?:\/\/[^\s<>"']+/g) ?? []).map((value) => value.replace(/[.,;!?)\]}]+$/, "")).filter((value) => {
      try { const url = new URL(value); return Boolean(url.hostname); } catch { return false; }
    })),
    numbers: () => unique((input.text.match(/[-+]?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b/g) ?? []).map(Number).filter(Number.isFinite)),
    dates: () => unique((input.text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []).filter((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    })),
  };
  return {
    mode: "deterministic-reference" as const,
    method: "Pattern extraction only; dates use ISO YYYY-MM-DD. No inferred facts or arbitrary schema execution.",
    data: Object.fromEntries(Object.entries(input.schema).map(([name, type]) => [name, extractors[type]()])),
  };
}

/** Genuine bounded local computation. Does not call remote models, URLs, or tools. */
export function executeService(kind: ServiceKind, input: unknown) {
  switch (kind) {
    case "summary": return summarize(serviceInputSchemas.summary.parse(input));
    case "analysis": return analyze(serviceInputSchemas.analysis.parse(input));
    case "extraction": return extract(serviceInputSchemas.extraction.parse(input));
    default: throw new Error("Unknown reference service");
  }
}

export type ServiceDefinition = {
  kind: ServiceKind; name: string; description: string; category: string; priceUnits: string;
  inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>;
  exampleInput: Record<string, unknown>; exampleOutput: unknown; documentation: string;
};

export const serviceDefinitions: ServiceDefinition[] = [
  {
    kind: "summary", name: "Clarity · Text Summary", category: "Content", priceUnits: "1000",
    description: "Turn a passage into a concise extractive summary. A deterministic reference service that selects the most informative original sentences.",
    inputSchema: { type: "object", required: ["text"], additionalProperties: false, properties: { text: { type: "string", minLength: 1, maxLength: 40000 }, maxSentences: { type: "integer", minimum: 1, maximum: 5 } } },
    outputSchema: { type: "object", required: ["mode", "summary", "sentences", "sourceSentenceCount", "sourceWordCount"], properties: { mode: { const: "deterministic-reference" }, summary: { type: "string" }, sentences: { type: "array", items: { type: "string" } }, sourceSentenceCount: { type: "integer" }, sourceWordCount: { type: "integer" } } },
    exampleInput: { text: "Agentra connects useful services. Buyers approve each payment. Services return verifiable results.", maxSentences: 2 },
    exampleOutput: {}, documentation: "POST text (up to 40,000 characters) and optional maxSentences (1–5). This local reference implementation ranks and returns original sentences; it is not a generative model.",
  },
  {
    kind: "analysis", name: "Vector · Data Analysis", category: "Data Intelligence", priceUnits: "2000",
    description: "Compute accurate statistics, first-to-last trends, and structured insights from your numeric dataset. Deterministic, private, and reproducible.",
    inputSchema: { type: "object", required: ["data"], additionalProperties: false, properties: { data: { oneOf: [{ type: "array", minItems: 1, maxItems: 1000, items: { type: "number", minimum: -1e15, maximum: 1e15 } }, { type: "array", minItems: 1, maxItems: 1000, items: { type: "object", minProperties: 1, maxProperties: 50, additionalProperties: { type: "number", minimum: -1e15, maximum: 1e15 } } }] } } },
    outputSchema: { type: "object", required: ["mode", "rowCount", "columns", "insights"], properties: { mode: { const: "deterministic-reference" }, rowCount: { type: "integer" }, columns: { type: "object" }, insights: { type: "array", items: { type: "string" } } } },
    exampleInput: { data: [12, 18, 24, 30, 36] }, exampleOutput: {}, documentation: "POST data as 1–1,000 numbers or numeric objects (up to 50 columns each). Missing columns are excluded from that column's count. Standard deviation is population-based. Trend compares first and last observed values; it is not a forecast.",
  },
  {
    kind: "extraction", name: "Prism · Structured Extraction", category: "Research", priceUnits: "1000",
    description: "Extract email addresses, public URL strings, numbers, and ISO dates into an explicit JSON schema. A deterministic pattern-based reference service.",
    inputSchema: { type: "object", required: ["text", "schema"], additionalProperties: false, properties: { text: { type: "string", minLength: 1, maxLength: 40000 }, schema: { type: "object", minProperties: 1, maxProperties: 16, additionalProperties: { enum: ["emails", "urls", "numbers", "dates"] } } } },
    outputSchema: { type: "object", required: ["mode", "data"], properties: { mode: { const: "deterministic-reference" }, data: { type: "object", additionalProperties: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } } } } },
    exampleInput: { text: "Contact hello@agentra.example by 2026-11-01. Read https://example.com for details.", schema: { contacts: "emails", deadlines: "dates", links: "urls" } }, exampleOutput: {}, documentation: "POST text and schema, a map of 1–16 output field names to emails, urls, numbers, or dates. Output contains deduplicated arrays. URLs are extracted as text and are never fetched. Dates must be valid ISO YYYY-MM-DD. Arbitrary JSON schemas and code are not executed.",
  },
];

for (const definition of serviceDefinitions) {
  definition.exampleOutput = executeService(definition.kind, definition.exampleInput);
}
