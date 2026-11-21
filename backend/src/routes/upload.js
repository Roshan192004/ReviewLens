import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { CONFIG } from "../config.js";
import { analyzeReviews } from "../services/batchRunner.js";
import { cleanReviews, parseCsv } from "../services/csvCleaner.js";
import { getReviewStore } from "../services/reviewStore.js";

export function createUploadRouter({
  analyze = analyzeReviews,
  store,
} = {}) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CONFIG.MAX_UPLOAD_BYTES },
    fileFilter(_req, file, callback) {
      if (!file.originalname.toLowerCase().endsWith(".csv")) {
        const error = new Error("Only .csv files are accepted.");
        error.status = 400;
        return callback(error);
      }
      callback(null, true);
    },
  });

  router.post("/", upload.single("file"), async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded. Send a CSV in the 'file' field.",
      });
    }

    if (req.file.size === 0) {
      return res.status(400).json({ error: "Uploaded file is empty." });
    }

    let rows;
    try {
      rows = parseCsv(req.file.buffer);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const cleaned = cleanReviews(rows);
    const ids = new Set();
    for (const review of cleaned.reviews) {
      if (ids.has(review.review_id)) {
        return res.status(400).json({
          error: `Duplicate review_id "${review.review_id}". Each review must have a unique ID.`,
        });
      }
      ids.add(review.review_id);
    }

    try {
      const activeStore = store || getReviewStore();
      const cached = activeStore.getCachedAnalyses(cleaned.reviews);
      const uncached = cleaned.reviews.filter(
        (review) => review.status === "pending" && !cached.has(review.review_id),
      );
      const analysisRun = uncached.length
        ? await analyze(uncached)
        : {
            results: [],
            stats: {
              llmCalls: 0,
              transportRetries: 0,
              batches: 0,
              analysed: 0,
              failed: 0,
              durationMs: 0,
            },
          };
      const analyzedById = new Map(
        analysisRun.results.map((result) => [result.review_id, result]),
      );
      const reviews = cleaned.reviews.map((review) => {
        if (review.status !== "pending") return review;

        const cachedResult = cached.get(review.review_id);
        if (cachedResult) {
          return {
            ...review,
            status: "analysed",
            analysis: cachedResult.analysis,
            error: null,
            suspicious_input: cachedResult.suspicious_input,
          };
        }

        const analysis = analyzedById.get(review.review_id);
        return analysis
          ? { ...review, ...analysis }
          : {
              ...review,
              status: "analysis_failed",
              analysis: null,
              error: "No analysis result was returned for this review.",
              suspicious_input: false,
            };
      });
      const stats = {
        ...analysisRun.stats,
        analysed: reviews.filter((review) => review.status === "analysed").length,
        failed: reviews.filter((review) => review.status === "analysis_failed").length,
        cacheHits: cached.size,
      };
      const saved = activeStore.saveUpload({
        upload_id: randomUUID(),
        filename: req.file.originalname,
        report: cleaned.report,
        stats,
        reviews,
      });

      return res.status(201).json(saved);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createUploadRouter;
