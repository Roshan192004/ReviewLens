import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import request from "supertest";
import { createApp } from "../src/server.js";
import { createReviewStore } from "../src/services/reviewStore.js";

const csv = Buffer.from(
  "review_id,product,rating,date,review_text\n" +
  "R1,Headphones,2,2024-01-01,The left earbud stopped working.\n",
);

describe("review API", () => {
  let store;
  let app;
  let createReply;

  beforeEach(() => {
    store = createReviewStore(new DatabaseSync(":memory:"));
    createReply = vi.fn().mockResolvedValue("We're sorry the earbud stopped working.");
    app = createApp({
      store,
      analyze: async (reviews) => ({
        results: reviews.map((review) => ({
          review_id: review.review_id,
          status: "analysed",
          analysis: {
            sentiment: "negative",
            topics: ["quality"],
            summary: "The earbud stopped working.",
            needs_reply: true,
          },
          error: null,
          suspicious_input: false,
        })),
        stats: { llmCalls: 1, transportRetries: 0, batches: 1 },
      }),
      createReply,
    });
  });

  afterEach(() => store.close());

  async function uploadReview() {
    const response = await request(app)
      .post("/api/upload")
      .attach("file", csv, "reviews.csv");
    expect(response.status).toBe(201);
    return response.body.upload_id;
  }

  it("retrieves a persisted upload by ID and as the latest upload", async () => {
    const uploadId = await uploadReview();

    const byId = await request(app).get(`/api/reviews?uploadId=${uploadId}`);
    const latest = await request(app).get("/api/reviews");

    expect(byId.status).toBe(200);
    expect(byId.body.upload_id).toBe(uploadId);
    expect(byId.body.reviews[0].analysis.sentiment).toBe("negative");
    expect(latest.body.upload_id).toBe(uploadId);
  });

  it("serves the sample CSV download", async () => {
    const response = await request(app).get("/api/sample.csv");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/csv/);
    expect(response.text).toContain("review_id,product,rating,date,review_text");
  });

  it("generates a reply once and returns the persisted suggestion thereafter", async () => {
    const uploadId = await uploadReview();

    const first = await request(app)
      .post("/api/reviews/R1/reply")
      .send({ upload_id: uploadId });
    const second = await request(app)
      .post("/api/reviews/R1/reply")
      .send({ upload_id: uploadId });

    expect(first.status).toBe(201);
    expect(first.body.reply).toBe("We're sorry the earbud stopped working.");
    expect(first.body.cached).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(createReply).toHaveBeenCalledOnce();
  });

  it("validates reply requests and returns not-found for unknown reviews", async () => {
    await expect(request(app)
      .post("/api/reviews/R1/reply")
      .send({})).resolves.toMatchObject({ status: 400 });

    const missing = await request(app)
      .post("/api/reviews/missing/reply")
      .send({ upload_id: "not-an-upload" });
    expect(missing.status).toBe(404);
  });
});
