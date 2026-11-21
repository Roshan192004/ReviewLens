import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../config.js";
import { hashText } from "../utils/hash.js";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function openDatabase() {
  const configuredPath = process.env.CACHE_DB_PATH || "cache.db";
  const databasePath = configuredPath === ":memory:"
    ? configuredPath
    : isAbsolute(configuredPath)
      ? configuredPath
      : resolve(backendDirectory, configuredPath);

  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  return new Database(databasePath);
}

function cacheKey(text) {
  return hashText(`${CONFIG.PROMPT_VERSION}\n${text}`);
}

function parseUpload(row, reviews) {
  if (!row) return null;
  return {
    upload_id: row.id,
    filename: row.filename,
    created_at: row.created_at,
    report: JSON.parse(row.report_json),
    stats: JSON.parse(row.stats_json),
    reviews,
  };
}

export function createReviewStore(database = openDatabase()) {
  const db = database;
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL,
      report_json TEXT NOT NULL,
      stats_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      review_id TEXT NOT NULL,
      product TEXT NOT NULL,
      rating INTEGER,
      rating_issue TEXT,
      date TEXT,
      text TEXT NOT NULL,
      text_hash TEXT,
      status TEXT NOT NULL,
      skip_reason TEXT,
      duplicate_of TEXT,
      id_issue TEXT,
      analysis_json TEXT,
      error TEXT,
      suspicious_input INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (upload_id, row_index),
      UNIQUE (upload_id, review_id)
    );

    CREATE TABLE IF NOT EXISTS analysis_cache (
      cache_key TEXT PRIMARY KEY,
      analysis_json TEXT NOT NULL,
      suspicious_input INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reply_suggestions (
      upload_id TEXT NOT NULL,
      review_id TEXT NOT NULL,
      reply TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (upload_id, review_id),
      FOREIGN KEY (upload_id, review_id)
        REFERENCES reviews(upload_id, review_id) ON DELETE CASCADE
    );
  `);

  const insertUpload = db.prepare(`
    INSERT INTO uploads (id, filename, created_at, report_json, stats_json)
    VALUES (@id, @filename, @created_at, @report_json, @stats_json)
  `);
  const insertReview = db.prepare(`
    INSERT INTO reviews (
      upload_id, row_index, review_id, product, rating, rating_issue, date,
      text, text_hash, status, skip_reason, duplicate_of, id_issue,
      analysis_json, error, suspicious_input
    ) VALUES (
      @upload_id, @row_index, @review_id, @product, @rating, @rating_issue, @date,
      @text, @text_hash, @status, @skip_reason, @duplicate_of, @id_issue,
      @analysis_json, @error, @suspicious_input
    )
  `);
  const insertCache = db.prepare(`
    INSERT INTO analysis_cache (cache_key, analysis_json, suspicious_input, created_at)
    VALUES (@cache_key, @analysis_json, @suspicious_input, @created_at)
    ON CONFLICT(cache_key) DO NOTHING
  `);
  const selectReviews = db.prepare(`
    SELECT * FROM reviews WHERE upload_id = ? ORDER BY row_index
  `);
  const selectReview = db.prepare(`
    SELECT * FROM reviews WHERE upload_id = ? AND review_id = ?
  `);

  function getUpload(uploadId) {
    const upload = db.prepare("SELECT * FROM uploads WHERE id = ?").get(uploadId);
    if (!upload) return null;

    const reviews = selectReviews.all(uploadId).map((row) => ({
      review_id: row.review_id,
      product: row.product,
      rating: row.rating,
      rating_issue: row.rating_issue,
      date: row.date,
      text: row.text,
      text_hash: row.text_hash,
      status: row.status,
      skip_reason: row.skip_reason,
      duplicate_of: row.duplicate_of,
      ...(row.id_issue ? { id_issue: row.id_issue } : {}),
      analysis: row.analysis_json ? JSON.parse(row.analysis_json) : null,
      error: row.error,
      suspicious_input: Boolean(row.suspicious_input),
    }));

    return parseUpload(upload, reviews);
  }

  const saveUploadTransaction = db.transaction((upload) => {
    insertUpload.run({
      id: upload.upload_id,
      filename: upload.filename,
      created_at: upload.created_at || new Date().toISOString(),
      report_json: JSON.stringify(upload.report),
      stats_json: JSON.stringify(upload.stats),
    });

    const uploadId = upload.upload_id;
    for (const [index, review] of upload.reviews.entries()) {
      const analysisJson = review.analysis ? JSON.stringify(review.analysis) : null;
      insertReview.run({
        upload_id: uploadId,
        row_index: index,
        review_id: review.review_id,
        product: review.product,
        rating: review.rating,
        rating_issue: review.rating_issue,
        date: review.date,
        text: review.text,
        text_hash: review.text_hash,
        status: review.status,
        skip_reason: review.skip_reason,
        duplicate_of: review.duplicate_of,
        id_issue: review.id_issue,
        analysis_json: analysisJson,
        error: review.error,
        suspicious_input: review.suspicious_input ? 1 : 0,
      });

      if (review.status === "analysed" && analysisJson && review.text_hash) {
        insertCache.run({
          cache_key: cacheKey(review.text),
          analysis_json: analysisJson,
          suspicious_input: review.suspicious_input ? 1 : 0,
          created_at: upload.created_at || new Date().toISOString(),
        });
      }
    }
  });

  return {
    close() {
      db.close();
    },

    saveUpload(upload) {
      const uploadId = upload.upload_id || randomUUID();
      const createdAt = upload.created_at || new Date().toISOString();
      saveUploadTransaction({
        ...upload,
        upload_id: uploadId,
        created_at: createdAt,
      });
      return getUpload(uploadId);
    },

    getUpload,

    getLatestUpload() {
      const row = db.prepare("SELECT * FROM uploads ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
      return row ? getUpload(row.id) : null;
    },

    getReview(uploadId, reviewId) {
      return selectReview.get(uploadId, reviewId);
    },

    getCachedAnalyses(reviews) {
      const select = db.prepare("SELECT analysis_json, suspicious_input FROM analysis_cache WHERE cache_key = ?");
      const cached = new Map();
      for (const review of reviews) {
        if (review.status !== "pending" || !review.text_hash) continue;
        const row = select.get(cacheKey(review.text));
        if (row) {
          cached.set(review.review_id, {
            analysis: JSON.parse(row.analysis_json),
            suspicious_input: Boolean(row.suspicious_input),
          });
        }
      }
      return cached;
    },

    getReply(uploadId, reviewId) {
      return db.prepare(`
        SELECT reply, created_at FROM reply_suggestions
        WHERE upload_id = ? AND review_id = ?
      `).get(uploadId, reviewId) || null;
    },

    saveReply(uploadId, reviewId, reply) {
      const createdAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO reply_suggestions (upload_id, review_id, reply, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(upload_id, review_id)
        DO UPDATE SET reply = excluded.reply, created_at = excluded.created_at
      `).run(uploadId, reviewId, reply, createdAt);
      return { reply, created_at: createdAt };
    },
  };
}

let defaultStore;

export function getReviewStore() {
  if (!defaultStore) defaultStore = createReviewStore();
  return defaultStore;
}
