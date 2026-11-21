// Shared text normalisation used by both duplicate detection and cache keying.
// Keeping this in one place ensures they always use identical logic.

import { createHash } from "node:crypto";

/**
 * normalizeText(text) → string
 *
 * Lowercase, trim leading/trailing whitespace, collapse all internal
 * whitespace runs (spaces, tabs, newlines) to a single space.
 * Does NOT strip HTML or decode entities – callers receive already-cleaned text.
 */
export function normalizeText(text) {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * hashText(text) → string (64-char hex SHA-256)
 *
 * Hash of normalizeText(text). Used as the cache key so that two reviews
 * with identical normalised content share one cached analysis.
 */
export function hashText(text) {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

