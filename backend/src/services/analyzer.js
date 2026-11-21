import { randomBytes } from "node:crypto";
import { complete } from "./llmClient.js";
import { validateBatchResponse } from "./responseValidator.js";
import { withBackoff } from "../utils/backoff.js";
import { BACKOFF } from "../config.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRetryPrompt,
  detectSuspiciousInput,
} from "../prompts/analysisPrompt.js";

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error?.message === "string") return error.message;
  if (typeof error === "string") return error;
  return "LLM request failed";
}

function uniqueIds(ids) {
  return [...new Set(ids)];
}

export async function analyzeBatch(
  reviews,
  { llm = complete, sleep, random, onRetry, onTransportError } = {},
) {
  const input = Array.isArray(reviews) ? reviews : [];
  let llmCalls = 0;
  let transportRetries = 0;
  const resultsById = new Map();

  const makeResult = (review, status, analysis, error) => ({
    review_id: review.review_id,
    status,
    analysis,
    error,
    suspicious_input: detectSuspiciousInput(review.text),
  });

  const expectedIds = uniqueIds(
    input
      .map((review) => review?.review_id)
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim()),
  );
  const reviewsById = new Map(
    input
      .filter((review) => typeof review?.review_id === "string" && review.review_id.trim())
      .map((review) => [review.review_id.trim(), review]),
  );

  let firstNonce;
  try {
    firstNonce = randomBytes(12).toString("hex");
  } catch {
    firstNonce = `${Date.now()}${Math.random()}`;
  }

  try {
    const firstText = await withBackoff(
      async () => {
        llmCalls++;
        return llm({
          system: buildSystemPrompt(),
          user: buildUserPrompt(input, firstNonce),
        });
      },
      {
        ...BACKOFF,
        sleep,
        random,
        onRetry: (event) => {
          transportRetries++;
          onRetry?.(event);
        },
      },
    );
    const first = validateBatchResponse(firstText, expectedIds);

    for (const [id, analysis] of first.valid) {
      const review = reviewsById.get(id);
      if (review) resultsById.set(id, makeResult(review, "analysed", analysis, null));
    }

    let retryIds = uniqueIds([...first.invalidIds, ...first.missingIds]);
    if (first.batchError) retryIds = expectedIds;
    retryIds = retryIds.filter((id) => reviewsById.has(id) && !resultsById.has(id));

    if (retryIds.length > 0) {
      const retryReviews = retryIds.map((id) => reviewsById.get(id));
      const errorsById = {};
      for (const id of retryIds) {
        if (first.errors[id]) errorsById[id] = first.errors[id];
        else if (first.missingIds.includes(id)) errorsById[id] = "missing from model response";
        else if (first.batchError) errorsById[id] = first.batchError;
      }

      let secondText;
      try {
        let retryNonce;
        try {
          retryNonce = randomBytes(12).toString("hex");
        } catch {
          retryNonce = `${Date.now()}${Math.random()}`;
        }
        secondText = await withBackoff(
          async () => {
            llmCalls++;
            return llm({
              system: buildSystemPrompt(),
              user: buildRetryPrompt(retryReviews, retryNonce, errorsById),
            });
          },
          {
            ...BACKOFF,
            sleep,
            random,
            onRetry: (event) => {
              transportRetries++;
              onRetry?.(event);
            },
          },
        );
      } catch (error) {
        const message = errorMessage(error);
        onTransportError?.(error);
        for (const id of retryIds) {
          const review = reviewsById.get(id);
          if (review) resultsById.set(id, makeResult(review, "analysis_failed", null, message));
        }
      }

      if (secondText !== undefined) {
        const second = validateBatchResponse(secondText, retryIds);
        for (const [id, analysis] of second.valid) {
          const review = reviewsById.get(id);
          if (review) resultsById.set(id, makeResult(review, "analysed", analysis, null));
        }

        for (const id of retryIds) {
          if (resultsById.has(id)) continue;
          const review = reviewsById.get(id);
          const reason =
            second.errors[id] ||
            (second.missingIds.includes(id) ? "missing from model response" : null) ||
            second.batchError ||
            "analysis validation failed";
          if (review) resultsById.set(id, makeResult(review, "analysis_failed", null, reason));
        }
      }
    }
  } catch (error) {
    const message = errorMessage(error);
    onTransportError?.(error);
    for (const review of input) {
      if (!review?.review_id) continue;
      const id = String(review.review_id).trim();
      if (!resultsById.has(id)) {
        resultsById.set(id, makeResult(review, "analysis_failed", null, message));
      }
    }
  }

  const results = input.map((review) => {
    if (!review?.review_id) {
      return {
        review_id: review?.review_id ?? null,
        status: "analysis_failed",
        analysis: null,
        error: "review_id: expected a non-empty string",
        suspicious_input: detectSuspiciousInput(review?.text),
      };
    }
    const id = String(review.review_id).trim();
    return resultsById.get(id) || makeResult(review, "analysis_failed", null, "analysis validation failed");
  });

  // llmCalls counts every provider attempt, including transport retries and the
  // one validation retry. transportRetries counts only transport failures that retried.
  return { results, llmCalls, transportRetries };
}
