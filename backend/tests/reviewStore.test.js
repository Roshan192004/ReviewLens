import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReviewStore } from "../src/services/reviewStore.js";

describe("reviewStore", () => {
  let store;
  beforeEach(() => {
    store = createReviewStore(new DatabaseSync(":memory:"));
  });
  afterEach(() => {
    store.close();
  });

  it("persists upload data and makes successful analyses available from cache", () => {
    const review = {
      review_id: "R1",
      product: "Headphones",
      rating: 2,
      rating_issue: null,
      date: "2024-01-01",
      text: "The sound stopped working.",
      text_hash: "hash",
      status: "analysed",
      skip_reason: null,
      duplicate_of: null,
      analysis: {
        sentiment: "negative",
        topics: ["quality"],
        summary: "The sound stopped working.",
        needs_reply: true,
      },
      error: null,
      suspicious_input: false,
    };
    const saved = store.saveUpload({
      upload_id: "upload-1",
      filename: "reviews.csv",
      report: { total_rows: 1 },
      stats: { analysed: 1 },
      reviews: [review],
    });

    expect(saved.upload_id).toBe("upload-1");
    expect(saved.reviews[0]).toMatchObject({
      review_id: "R1",
      status: "analysed",
      analysis: review.analysis,
    });
    expect(store.getLatestUpload().upload_id).toBe("upload-1");
    expect(store.getReview("upload-1", "R1").text).toBe(review.text);
    expect(store.getCachedAnalyses([{ ...review, status: "pending" }]).get("R1"))
      .toEqual({ analysis: review.analysis, suspicious_input: false });
  });

  it("stores and retrieves a reply suggestion for its upload", () => {
    store.saveUpload({
      upload_id: "upload-2",
      filename: "reviews.csv",
      report: {},
      stats: {},
      reviews: [{
        review_id: "R2",
        product: "Watch",
        rating: 1,
        date: null,
        text: "It broke.",
        status: "analysed",
        analysis: { sentiment: "negative" },
      }],
    });

    const saved = store.saveReply("upload-2", "R2", "We're sorry to hear that.");
    expect(saved.reply).toBe("We're sorry to hear that.");
    expect(store.getReply("upload-2", "R2")).toEqual(saved);
  });

  it("retains upload results after reopening the SQLite database", () => {
    const directory = mkdtempSync(join(tmpdir(), "reviewlens-test-"));
    let activeStore;
    try {
      activeStore = createReviewStore(new DatabaseSync(join(directory, "reviews.db")));
      activeStore.saveUpload({
        upload_id: "persistent-upload",
        filename: "reviews.csv",
        report: { total_rows: 1 },
        stats: { analysed: 1 },
        reviews: [{
          review_id: "R3",
          product: "Watch",
          rating: 4,
          date: "2024-01-03",
          text: "Still working.",
          status: "analysed",
          analysis: { sentiment: "positive", topics: ["quality"] },
        }],
      });
      activeStore.close();

      activeStore = createReviewStore(new DatabaseSync(join(directory, "reviews.db")));
      expect(activeStore.getUpload("persistent-upload").reviews[0].text)
        .toBe("Still working.");
    } finally {
      if (activeStore) activeStore.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
