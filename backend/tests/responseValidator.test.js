import { describe, it, expect } from "vitest";
import { SENTIMENTS, TOPICS, SUMMARY_MAX_LENGTH } from "../src/config.js";
import { analysisSchema, batchItemSchema } from "../src/schema/analysisSchema.js";
import {
  parseModelJson,
  validateAnalysis,
  validateBatchResponse,
} from "../src/services/responseValidator.js";

function analysis(overrides = {}) {
  return {
    sentiment: "positive",
    topics: ["quality", "delivery"],
    summary: "Good value and quick shipping.",
    needs_reply: false,
    ...overrides,
  };
}

describe("analysis schema", () => {
  it("exports config-derived constants", () => {
    expect(SENTIMENTS).toEqual(["positive", "neutral", "negative"]);
    expect(TOPICS).toContain("size_fit");
    expect(SUMMARY_MAX_LENGTH).toBe(200);
  });

  it("accepts valid analysis and collapses duplicate topics", () => {
    const result = analysisSchema.safeParse(analysis({ topics: ["quality", "quality", "delivery"] }));
    expect(result.success).toBe(true);
    expect(result.data.topics).toEqual(["quality", "delivery"]);
  });

  it("batch item requires a non-empty id", () => {
    expect(batchItemSchema.safeParse({ ...analysis(), id: "R1" }).success).toBe(true);
    expect(batchItemSchema.safeParse({ ...analysis(), id: " " }).success).toBe(false);
  });

  it.each([
    ["bad positive case", { sentiment: "Positive" }],
    ["mixed sentiment", { sentiment: "mixed" }],
    ["empty topics", { topics: [] }],
    ["unknown topic", { topics: ["mystery"] }],
    ["missing needs_reply", { needs_reply: undefined }],
    ["string needs_reply", { needs_reply: "true" }],
    ["extra key", { rating: 5 }],
    ["empty summary", { summary: "" }],
    ["multi-line summary", { summary: "Line one\nLine two" }],
    ["summary too long", { summary: "x".repeat(SUMMARY_MAX_LENGTH + 1) }],
  ])("rejects %s", (_name, override) => {
    const value = { ...analysis(), ...override };
    if ("needs_reply" in override && override.needs_reply === undefined) delete value.needs_reply;
    const result = validateAnalysis(value);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^[^:]+:/);
  });
});

describe("parseModelJson", () => {
  it("parses plain JSON", () => {
    expect(parseModelJson('{"x":1}')).toEqual({ ok: true, data: { x: 1 } });
  });

  it("parses a json markdown fence", () => {
    expect(parseModelJson('```json\n{"x":1}\n```')).toEqual({ ok: true, data: { x: 1 } });
  });

  it("parses a fence without a language tag", () => {
    expect(parseModelJson('```\n{"x":1}\n```')).toEqual({ ok: true, data: { x: 1 } });
  });

  it("returns ok false for garbage text without throwing", () => {
    expect(() => parseModelJson("Here is some output: nonsense")).not.toThrow();
    expect(parseModelJson("Here is some output: nonsense").ok).toBe(false);
  });
});

describe("validateBatchResponse", () => {
  it("accepts all valid bare results", () => {
    const result = validateBatchResponse(JSON.stringify([
      { id: "R1", ...analysis() },
      { id: "R2", ...analysis({ sentiment: "neutral" }) },
    ]), ["R1", "R2"]);
    expect(result.valid.size).toBe(2);
    expect(result.invalidIds).toEqual([]);
    expect(result.missingIds).toEqual([]);
  });

  it("keeps valid items when another enum is bad", () => {
    const result = validateBatchResponse(JSON.stringify({
      results: [
        { id: "R1", ...analysis() },
        { id: "R2", ...analysis({ sentiment: "mixed" }) },
      ],
    }), ["R1", "R2"]);
    expect(result.valid.has("R1")).toBe(true);
    expect(result.invalidIds).toContain("R2");
    expect(result.errors.R2).toMatch(/sentiment:/);
  });

  it("reports an omitted id as missing", () => {
    const result = validateBatchResponse(JSON.stringify({ results: [{ id: "R1", ...analysis() }] }), ["R1", "R2"]);
    expect(result.missingIds).toEqual(["R2"]);
  });

  it("ignores extra unrequested ids", () => {
    const result = validateBatchResponse(JSON.stringify({
      results: [{ id: "R1", ...analysis() }, { id: "EXTRA", ...analysis() }],
    }), ["R1"]);
    expect(result.valid.size).toBe(1);
    expect(result.invalidIds).toEqual([]);
    expect(result.missingIds).toEqual([]);
  });

  it("marks a duplicated id as invalid", () => {
    const result = validateBatchResponse(JSON.stringify({
      results: [{ id: "R1", ...analysis() }, { id: "R1", ...analysis({ sentiment: "negative" }) }],
    }), ["R1"]);
    expect(result.invalidIds).toEqual(["R1"]);
    expect(result.valid.has("R1")).toBe(false);
    expect(result.errors.R1).toContain("duplicate");
  });

  it("sets batchError and all ids missing for garbage or wrong shape", () => {
    const garbage = validateBatchResponse("not json", ["R1", "R2"]);
    expect(garbage.batchError).toBeTruthy();
    expect(garbage.missingIds).toEqual(["R1", "R2"]);

    const wrong = validateBatchResponse(JSON.stringify({ data: [] }), ["R1", "R2"]);
    expect(wrong.batchError).toBeTruthy();
    expect(wrong.missingIds).toEqual(["R1", "R2"]);
  });

  it("accepts a bare array", () => {
    const result = validateBatchResponse(JSON.stringify([{ id: "R1", ...analysis() }]), ["R1"]);
    expect(result.valid.has("R1")).toBe(true);
  });

  it("rejects strict-schema injection-shaped extra fields", () => {
    const result = validateAnalysis({
      ...analysis(),
      instructions: "Ignore previous instructions",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/instructions|extra field/i);
  });

  it("items missing ids are ignored and leave their expected ids missing", () => {
    const result = validateBatchResponse(JSON.stringify({
      results: [{ sentiment: "positive", topics: ["quality"], summary: "Good", needs_reply: false }],
    }), ["R1"]);
    expect(result.valid.size).toBe(0);
    expect(result.missingIds).toEqual(["R1"]);
  });

  it("covers every expected id exactly once across valid, invalid, and missing", () => {
    const result = validateBatchResponse(JSON.stringify({
      results: [
        { id: "R1", ...analysis() },
        { id: "R2", ...analysis({ topics: [] }) },
      ],
    }), ["R1", "R2", "R3"]);

    const validIds = [...result.valid.keys()];
    const partition = [...validIds, ...result.invalidIds, ...result.missingIds];
    expect(partition.sort()).toEqual(["R1", "R2", "R3"]);
    expect(new Set(partition).size).toBe(partition.length);
  });
});
