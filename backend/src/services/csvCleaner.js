// CSV parsing and row-level cleaning.
// This module has NO I/O – it accepts a Buffer and returns plain objects.
// That makes it trivially unit-testable.

import { parse } from "csv-parse/sync";
import { normalizeText, hashText } from "../utils/hash.js";
import { CONFIG } from "../config.js";

// Columns that MUST be present in the CSV header.
const REQUIRED_COLUMNS = ["review_id", "product", "rating", "date", "review_text"];

// ─── HTML helpers ────────────────────────────────────────────────────────────

// Named entities we decode. We only handle the 5 common ones; a full HTML
// parser would add an unnecessary dependency for this use-case.
const ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** Strip HTML tags and decode the 5 common named entities (applied repeatedly
 *  until stable so double-encoded values like &amp;lt; also resolve).
 *  HTML tags are stripped FIRST so that encoded characters (&lt; &gt;) are preserved. */
function cleanHtml(raw) {
  if (!raw) return "";
  // 1. Strip HTML tags first
  let text = String(raw).replace(/<[^>]*>/g, "");
  // 2. Decode entities iteratively until no more changes (handles double-encoding)
  let prev;
  do {
    prev = text;
    text = text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ENTITY_MAP[m]);
  } while (text !== prev);
  return text;
}

/** Collapse whitespace and trim. Called AFTER HTML stripping so that newlines
 *  introduced by tag removal are cleaned up too. */
function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

// ─── Rating helper ───────────────────────────────────────────────────────────

/**
 * parseRating(raw) → { rating: number|null, rating_issue: null|"missing"|"invalid" }
 *
 * Accepts integers 1-5 as a number or string (e.g. "4", "4.0").
 * Blank / absent → null + "missing".
 * Anything else → null + "invalid".  Never throws.
 */
function parseRating(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { rating: null, rating_issue: "missing" };
  }
  const num = Number(raw);
  // Must be a whole number between 1 and 5 (4.0 is acceptable, 4.5 is not)
  if (!Number.isNaN(num) && Number.isInteger(num) && num >= 1 && num <= 5) {
    return { rating: num, rating_issue: null };
  }
  // Also accept strings like "4.0" that parse to an integer value
  if (!Number.isNaN(num) && num === Math.floor(num) && num >= 1 && num <= 5) {
    return { rating: Math.floor(num), rating_issue: null };
  }
  return { rating: null, rating_issue: "invalid" };
}

// ─── Date helper ─────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(raw) {
  if (!raw || !DATE_RE.test(raw.trim())) return null;
  return raw.trim();
}

// ─── ID helper ───────────────────────────────────────────────────────────────

/**
 * Sanitise a review_id. If blank or missing, generate "ROW-<n>".
 * Returns { id, id_issue }.
 */
function sanitiseId(raw, rowIndex) {
  const trimmed = raw ? String(raw).trim() : "";
  if (!trimmed) {
    return { id: `ROW-${rowIndex}`, id_issue: "missing_id" };
  }
  return { id: trimmed, id_issue: null };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * parseCsv(buffer) → raw row objects from csv-parse.
 *
 * Throws a plain Error (not a crash) if the buffer is unparseable or missing
 * required columns – the caller (upload route) catches and returns HTTP 400.
 */
export function parseCsv(buffer) {
  let rows;
  try {
    rows = parse(buffer, {
      columns: true,           // use first row as column names
      bom: true,               // strip BOM so UTF-8 files work correctly
      skip_empty_lines: true,  // ignore completely blank lines
      trim: true,              // trim cell whitespace (but NOT inside quoted fields)
      relax_column_count: true, // tolerate rows with extra/missing commas
    });
  } catch (err) {
    throw new Error(`CSV parse error: ${err.message}`);
  }

  if (rows.length === 0) {
    throw new Error("CSV file is empty or contains only a header row.");
  }

  // Validate that the required columns exist in the header
  const headers = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);
  }

  return rows;
}

/**
 * cleanReviews(rows) → { reviews, report }
 *
 * Pure function: takes the raw row array from parseCsv and applies all
 * cleaning rules. Returns the cleaned review objects and a summary report.
 *
 * Row numbering starts at 2 (row 1 = header).
 */
export function cleanReviews(rows) {
  // Track normalised text of valid reviews to detect duplicates.
  // Maps normalizedText → review_id of the first occurrence.
  const seenTexts = new Map();

  const reviews = [];

  // Counters for the report
  let skipped = 0;
  let duplicates = 0;
  let missing_ratings = 0;
  let invalid_ratings = 0;
  const skipped_ids = [];
  const duplicate_pairs = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2; // +2 because row 1 is the header

    // ── ID ────────────────────────────────────────────────────────────────
    const { id: review_id, id_issue } = sanitiseId(row.review_id, rowNum);

    // ── Product ───────────────────────────────────────────────────────────
    const product = row.product?.trim() || "Unknown product";

    // ── Rating ───────────────────────────────────────────────────────────
    const { rating, rating_issue } = parseRating(row.rating);
    if (rating_issue === "missing") missing_ratings++;
    if (rating_issue === "invalid") invalid_ratings++;

    // ── Date ─────────────────────────────────────────────────────────────
    const date = parseDate(row.date);

    // ── Text cleaning ─────────────────────────────────────────────────────
    const rawText = row.review_text ?? "";
    const decoded = cleanHtml(rawText);
    const text = collapseWhitespace(decoded);

    // ── Empty text check ─────────────────────────────────────────────────
    // A string that is empty after cleaning is skipped.
    // Emoji-only ("👍👍") and non-Latin scripts have length > 0 and are valid.
    if (text === "") {
      skipped++;
      skipped_ids.push(review_id);
      reviews.push({
        review_id,
        product,
        rating,
        rating_issue,
        date,
        text: "",
        text_hash: null,
        status: "skipped",
        skip_reason: "empty_text",
        duplicate_of: null,
        ...(id_issue ? { id_issue } : {}),
      });
      return; // move to next row
    }

    // ── Duplicate detection ───────────────────────────────────────────────
    const normalized = normalizeText(text);
    const text_hash = hashText(text);

    if (seenTexts.has(normalized)) {
      const original_id = seenTexts.get(normalized);
      duplicates++;
      duplicate_pairs.push({ id: review_id, duplicate_of: original_id });
      reviews.push({
        review_id,
        product,
        rating,
        rating_issue,
        date,
        text,
        text_hash,
        status: "duplicate",
        skip_reason: null,
        duplicate_of: original_id,
        ...(id_issue ? { id_issue } : {}),
      });
      return;
    }

    // ── Valid review ──────────────────────────────────────────────────────
    seenTexts.set(normalized, review_id);
    reviews.push({
      review_id,
      product,
      rating,
      rating_issue,
      date,
      text,
      text_hash,
      status: "pending",
      skip_reason: null,
      duplicate_of: null,
      ...(id_issue ? { id_issue } : {}),
    });
  });

  const valid = rows.length - skipped - duplicates;

  const report = {
    total_rows: rows.length,
    valid,
    skipped,
    duplicates,
    missing_ratings,
    invalid_ratings,
    skipped_ids,
    duplicate_pairs,
  };

  return { reviews, report };
}

