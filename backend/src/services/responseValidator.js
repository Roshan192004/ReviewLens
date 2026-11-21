import { SENTIMENTS, TOPICS, SUMMARY_MAX_LENGTH } from "../config.js";
import { analysisSchema, batchItemSchema } from "../schema/analysisSchema.js";

export function parseModelJson(text) {
  if (typeof text !== "string") {
    return { ok: false, error: "model output is not text" };
  }

  let candidate = text.trim();
  if (!candidate) {
    return { ok: false, error: "model output is empty" };
  }

  const fence = candidate.match(/^```(?:[A-Za-z0-9_-]+)?\s*\n([\s\S]*?)\r?\n?```$/);
  if (fence) {
    candidate = fence[1].trim();
  }

  try {
    return { ok: true, data: JSON.parse(candidate) };
  } catch {
    return { ok: false, error: "model output is not valid JSON" };
  }
}

function readableIssue(issue) {
  const field = issue.path?.length ? issue.path.join(".") : "object";
  if (field === "sentiment") {
    return `sentiment: expected one of ${SENTIMENTS.join("|")}`;
  }
  if (field === "topics") {
    return `topics: expected at least 1 topic from ${TOPICS.join("|")}`;
  }
  if (field === "summary") {
    if (issue.code === "too_big") return `summary: expected at most ${SUMMARY_MAX_LENGTH} characters`;
    if (issue.code === "too_small") return "summary: expected a non-empty string";
    return "summary: expected a string with no line breaks";
  }
  if (field === "needs_reply") {
    return "needs_reply: expected a boolean";
  }
  if (field === "id") {
    return "id: expected a non-empty string";
  }
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys?.join(", ") || "unknown";
    return `${keys}: extra field is not allowed`;
  }
  if (issue.code === "invalid_type") {
    return `${field}: expected ${issue.expected}`;
  }
  return `${field}: ${issue.message || "invalid value"}`;
}

export function validateAnalysis(obj) {
  const result = analysisSchema.safeParse(obj);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: readableIssue(result.error.issues[0]) };
}

export function validateBatchResponse(text, expectedIds) {
  const valid = new Map();
  const invalidIds = [];
  const missingIds = [];
  const errors = {};
  let batchError = null;

  const expected = new Set(
    Array.isArray(expectedIds)
      ? expectedIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
      : [],
  );

  const parsed = parseModelJson(text);
  if (!parsed.ok) {
    batchError = parsed.error;
    for (const id of expected) missingIds.push(id);
    return { valid, invalidIds, missingIds, errors, batchError };
  }

  let items;
  if (Array.isArray(parsed.data)) {
    items = parsed.data;
  } else if (
    parsed.data &&
    typeof parsed.data === "object" &&
    !Array.isArray(parsed.data) &&
    Array.isArray(parsed.data.results)
  ) {
    items = parsed.data.results;
  } else {
    batchError = "top-level shape: expected a results array or a bare array";
    for (const id of expected) missingIds.push(id);
    return { valid, invalidIds, missingIds, errors, batchError };
  }

  const counts = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (typeof item.id !== "string") continue;
    const id = item.id.trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  for (const [id, count] of counts) {
    if (count > 1 && expected.has(id)) {
      invalidIds.push(id);
      errors[id] = "id: duplicate id is ambiguous";
    }
  }

  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (typeof item.id !== "string") continue;
    const id = item.id.trim();
    if (!id || !expected.has(id) || counts.get(id) > 1) continue;

    const result = batchItemSchema.safeParse(item);
    if (result.success) {
      valid.set(id, {
        sentiment: result.data.sentiment,
        topics: result.data.topics,
        summary: result.data.summary,
        needs_reply: result.data.needs_reply,
      });
    } else {
      invalidIds.push(id);
      errors[id] = readableIssue(result.error.issues[0]);
    }
  }

  for (const id of expected) {
    if (!valid.has(id) && !invalidIds.includes(id)) missingIds.push(id);
  }

  return { valid, invalidIds, missingIds, errors, batchError };
}
