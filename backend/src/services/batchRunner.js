import { analyzeBatch } from "./analyzer.js";
import { complete } from "./llmClient.js";
import { BATCH_SIZE, MAX_CONCURRENT_BATCHES } from "../config.js";

function authStatus(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  return status === 401 || status === 403;
}

export async function analyzeReviews(
  reviews,
  { llm = complete, sleep, onProgress } = {},
) {
  const input = Array.isArray(reviews) ? reviews : [];
  const startedAt = Date.now();
  const pending = input.filter((review) => review?.status === "pending");
  const chunks = [];
  for (let index = 0; index < pending.length; index += BATCH_SIZE) {
    chunks.push(pending.slice(index, index + BATCH_SIZE));
  }

  const resultById = new Map();
  let llmCalls = 0;
  let transportRetries = 0;
  let analysed = 0;
  let failed = 0;
  let done = 0;
  let batches = 0;
  let authStopped = false;

  let nextChunk = 0;
  const workerCount = Math.min(MAX_CONCURRENT_BATCHES, chunks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!authStopped) {
      const chunkIndex = nextChunk++;
      if (chunkIndex >= chunks.length) break;
      const chunk = chunks[chunkIndex];
      batches++;

      const output = await analyzeBatch(chunk, {
        llm,
        sleep,
        onTransportError: (error) => {
          if (authStatus(error)) authStopped = true;
        },
      });

      llmCalls += output.llmCalls;
      transportRetries += output.transportRetries;
      for (const item of output.results) {
        resultById.set(item.review_id, item);
        if (item.status === "analysed") analysed++;
        if (item.status === "analysis_failed") failed++;
      }

      done++;
      onProgress?.({ done, total: chunks.length });
    }
  });

  await Promise.all(workers);

  const results = input.map((review) => {
    if (review?.status !== "pending") return { ...review };
    const id = review.review_id;
    if (resultById.has(id)) return resultById.get(id);

    failed++;
    return {
      review_id: id,
      status: "analysis_failed",
      analysis: null,
      error: authStopped ? "API key rejected" : "analysis batch not scheduled",
      suspicious_input: false,
    };
  });

  return {
    results,
    stats: {
      llmCalls,
      transportRetries,
      batches,
      analysed,
      failed,
      durationMs: Date.now() - startedAt,
    },
  };
}
