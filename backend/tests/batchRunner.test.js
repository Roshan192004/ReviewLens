import { describe, it, expect, vi } from "vitest";
import { analyzeReviews } from "../src/services/batchRunner.js";

function review(id, status = "pending", text = "Normal review") {
  return { review_id: id, status, text, product: "P", rating: 5, date: "2024-01-01" };
}

function valid(id, sentiment = "positive") {
  return JSON.stringify({
    results: [{ id, sentiment, topics: ["quality"], summary: "Good quality.", needs_reply: false }],
  });
}

function idsInPrompt(prompt) {
  return [...prompt.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
}

describe("batchRunner", () => {
  it("batches 12 pending reviews into sizes 5, 5, 2", async () => {
    const batchSizes = [];
    const llm = vi.fn(async ({ user }) => {
      const ids = idsInPrompt(user);
      batchSizes.push(ids.length);
      return JSON.stringify({ results: ids.map((id) => ({
        id, sentiment: "positive", topics: ["quality"], summary: "Good.", needs_reply: false,
      })) });
    });
    const output = await analyzeReviews(
      Array.from({ length: 12 }, (_, index) => review(`R${index + 1}`)),
      { llm, sleep: async () => {} },
    );
    expect(batchSizes.sort((a, b) => a - b)).toEqual([2, 5, 5]);
    expect(output.stats.batches).toBe(3);
  });

  it("never exceeds two batches in flight", async () => {
    let concurrent = 0;
    let peak = 0;
    const llm = vi.fn(async ({ user }) => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const ids = idsInPrompt(user);
      concurrent--;
      return JSON.stringify({ results: ids.map((id) => ({
        id, sentiment: "positive", topics: ["quality"], summary: "Good.", needs_reply: false,
      })) });
    });
    await analyzeReviews(
      Array.from({ length: 12 }, (_, index) => review(`R${index + 1}`)),
      { llm, sleep: async () => {} },
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("keeps output in original input order when batches finish out of order", async () => {
    const llm = vi.fn(async ({ user }) => {
      const ids = idsInPrompt(user);
      await new Promise((resolve) => setTimeout(resolve, ids[0].endsWith("1") ? 20 : 1));
      return JSON.stringify({ results: ids.map((id) => ({
        id, sentiment: "positive", topics: ["quality"], summary: "Good.", needs_reply: false,
      })) });
    });
    const input = [review("R3"), review("R1"), review("R2")];
    const output = await analyzeReviews(input, { llm, sleep: async () => {} });
    expect(output.results.map((item) => item.review_id)).toEqual(["R3", "R1", "R2"]);
    expect(output.results[0].product).toBe("P");
    expect(output.results[0].text).toBe("Normal review");
  });

  it("passes skipped and duplicate reviews through without sending them", async () => {
    const llm = vi.fn(async ({ user }) => {
      const ids = idsInPrompt(user);
      return JSON.stringify({ results: ids.map((id) => ({
        id, sentiment: "positive", topics: ["quality"], summary: "Good.", needs_reply: false,
      })) });
    });
    const skipped = review("S1", "skipped");
    const duplicate = review("D1", "duplicate");
    const output = await analyzeReviews([skipped, review("R1"), duplicate], { llm, sleep: async () => {} });
    expect(output.results[0]).toEqual(skipped);
    expect(output.results[2]).toEqual(duplicate);
  });

  it("isolates a persistent 500 batch", async () => {
    const llm = vi.fn(async ({ user }) => {
      if (user.includes('id="R6"')) throw Object.assign(new Error("server unavailable"), { status: 500 });
      const ids = idsInPrompt(user);
      return JSON.stringify({ results: ids.map((id) => ({
        id, sentiment: "positive", topics: ["quality"], summary: "Good.", needs_reply: false,
      })) });
    });
    const input = Array.from({ length: 12 }, (_, index) => review(`R${index + 1}`));
    const output = await analyzeReviews(input, { llm, sleep: async () => {}, random: () => 1 });
    expect(output.results.find((item) => item.review_id === "R6").status).toBe("analysis_failed");
    expect(output.results.find((item) => item.review_id === "R1").status).toBe("analysed");
  });

  it("retries 429 and succeeds, with one transport retry", async () => {
    const llm = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("limited"), { status: 429 }))
      .mockResolvedValue(JSON.stringify({
        results: [{ id: "R1", sentiment: "positive", topics: ["quality"], summary: "Good.", needs_reply: false }],
      }));
    const output = await analyzeReviews([review("R1")], { llm, sleep: async () => {}, random: () => 1 });
    expect(output.results[0].status).toBe("analysed");
    expect(output.stats.transportRetries).toBe(1);
  });

  it("401 stops scheduling and marks remaining pending reviews key-rejected", async () => {
    const llm = vi.fn().mockRejectedValue(Object.assign(new Error("bad key"), { status: 401 }));
    const input = Array.from({ length: 12 }, (_, index) => review(`R${index + 1}`));
    const output = await analyzeReviews(input, { llm, sleep: async () => {}, random: () => 1 });
    expect(output.results.some((item) => item.error === "API key rejected")).toBe(true);
    expect(llm.mock.calls.length).toBeLessThan(12);
  });

  it("keeps transport retry and validation retry independent", async () => {
    const llm = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("limited"), { status: 429 }))
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce(valid("R1"));
    const output = await analyzeReviews([review("R1")], { llm, sleep: async () => {}, random: () => 1 });
    expect(output.results[0].status).toBe("analysed");
    expect(output.stats.llmCalls).toBe(3);
    expect(output.stats.transportRetries).toBe(1);
  });
});
