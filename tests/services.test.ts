import { describe, expect, it } from "vitest";
import { executeService, serviceDefinitions, validateServiceInput } from "../lib/services";

describe("deterministic reference services", () => {
  it("selects actual source sentences and honors summary limits", () => {
    const input = { text: "Payments need approval. Payments use USDC. A rabbit sleeps.", maxSentences: 2 };
    const result = executeService("summary", input) as { mode: string; summary: string; sentences: string[] };
    expect(result.mode).toBe("deterministic-reference");
    expect(result.sentences).toHaveLength(2);
    for (const sentence of result.sentences) expect(input.text).toContain(sentence);
    expect(result.summary).toContain("Payments");
    expect(executeService("summary", input)).toEqual(result);
    const newlineResult = executeService("summary", { text: "First line\nSecond line", maxSentences: 2 }) as { sentences: string[] };
    expect(newlineResult.sentences).toEqual(["First line", "Second line"]);
  });

  it("computes verified population statistics and trends", () => {
    const result = executeService("analysis", { data: [2, 4, 6, 8] }) as { columns: Record<string, Record<string, unknown>> };
    expect(result.columns.value).toMatchObject({ count: 4, sum: 20, mean: 5, median: 5, min: 2, max: 8, trend: "increasing", changePercent: 300 });
    expect(result.columns.value.standardDeviation).toBeCloseTo(Math.sqrt(5));
  });

  it("handles numeric columns and a zero baseline without fabricated percentages", () => {
    const result = executeService("analysis", { data: [{ revenue: 0, cost: 9 }, { revenue: 10 }, { revenue: 20, cost: 3 }] }) as { columns: Record<string, Record<string, unknown>> };
    expect(result.columns.revenue).toMatchObject({ count: 3, mean: 10, changePercent: null });
    expect(result.columns.cost).toMatchObject({ count: 2, mean: 6, trend: "decreasing" });
  });

  it("extracts only selected patterns and rejects impossible calendar dates", () => {
    const result = executeService("extraction", {
      text: "hello@example.com hello@example.com https://example.com/docs. 2024-02-29 and 2025-02-29",
      schema: { contacts: "emails", links: "urls", dates: "dates" },
    }) as { data: Record<string, unknown> };
    expect(result.data).toEqual({ contacts: ["hello@example.com"], links: ["https://example.com/docs"], dates: ["2024-02-29"] });
  });

  it("rejects unsupported schema types, mixed datasets, invalid numbers, and oversized input", () => {
    expect(() => validateServiceInput("extraction", { text: "hi", schema: { execute: "javascript" } })).toThrow();
    expect(() => validateServiceInput("extraction", { text: "hi", schema: {} })).toThrow();
    expect(() => validateServiceInput("analysis", { data: [1, { x: 2 }] })).toThrow();
    expect(() => validateServiceInput("analysis", { data: [Infinity] })).toThrow();
    expect(() => validateServiceInput("summary", { text: "x".repeat(40_001) })).toThrow();
    expect(() => validateServiceInput("summary", { text: "hi", maxSentences: 0 })).toThrow();
    expect(() => validateServiceInput("summary", { text: "hi", remoteUrl: "https://example.com" })).toThrow();
  });

  it("generates truthful examples using the implementation", () => {
    expect(serviceDefinitions).toHaveLength(3);
    for (const service of serviceDefinitions) {
      expect(service.exampleOutput).toEqual(executeService(service.kind, service.exampleInput));
    }
  });
});
