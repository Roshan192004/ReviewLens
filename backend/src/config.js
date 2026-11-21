// Central configuration – import this wherever you need a constant.
// Changing PROMPT_VERSION invalidates cached LLM results (see reviewStore.js).

export const SENTIMENTS = ["positive", "neutral", "negative"];
export const TOPICS = ["quality", "delivery", "price", "packaging", "support", "size_fit", "other"];
export const SUMMARY_MAX_LENGTH = 200;
export const BATCH_SIZE = 5;
export const MAX_CONCURRENT_BATCHES = 2;
export const BACKOFF = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export const CONFIG = {
  // ── LLM ──────────────────────────────────────────────────────────────────
  PROMPT_VERSION: "v2",          // bump when the analysis prompt changes
  MODEL_NAME: "gemini-3.5-flash-lite",
  TEMPERATURE: 0,                // deterministic output

  // ── Batching & retries ───────────────────────────────────────────────────
  BATCH_SIZE,                    // reviews per LLM request
  MAX_CONCURRENCY: MAX_CONCURRENT_BATCHES,
  MAX_RETRY_ATTEMPTS: BACKOFF.maxAttempts,
  BASE_BACKOFF_MS: BACKOFF.baseDelayMs,
  MAX_BACKOFF_MS: BACKOFF.maxDelayMs,

  // ── Upload ───────────────────────────────────────────────────────────────
  MAX_UPLOAD_BYTES: 2 * 1024 * 1024, // 2 MB
  REQUIRED_CSV_COLUMNS: ["review_id", "product", "rating", "date", "review_text"],

  // ── Validation ───────────────────────────────────────────────────────────
  VALID_SENTIMENTS: SENTIMENTS,
  VALID_TOPICS: TOPICS,
};

