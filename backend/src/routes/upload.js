// POST /api/upload
// Accepts a CSV file (multipart field "file"), cleans it, and returns the
// cleaned reviews plus a cleaning report. No LLM calls happen here.

import { Router } from "express";
import multer from "multer";
import { parseCsv, cleanReviews } from "../services/csvCleaner.js";
import { CONFIG } from "../config.js";

const router = Router();

// ── Multer setup ─────────────────────────────────────────────────────────────
// memoryStorage keeps the file in RAM (fine for the 2 MB limit).
// The size limit rejects oversized uploads before they hit our code.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONFIG.MAX_UPLOAD_BYTES },
  fileFilter(_req, file, cb) {
    // Accept only files whose original name ends with .csv
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      return cb(new Error("Only .csv files are accepted."));
    }
    cb(null, true);
  },
});

// ── Route ─────────────────────────────────────────────────────────────────────
// single("file") means we expect exactly one file in the "file" field.
router.post(
  "/",
  upload.single("file"),
  (req, res) => {
    // Multer puts the file on req.file; if the field is absent it is undefined.
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Send a CSV in the 'file' field." });
    }

    if (req.file.size === 0) {
      return res.status(400).json({ error: "Uploaded file is empty." });
    }

    let rows;
    try {
      // parseCsv throws a plain Error for bad CSV or missing columns.
      rows = parseCsv(req.file.buffer);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // cleanReviews is pure – it never throws; bad rows get status "skipped".
    const { reviews, report } = cleanReviews(rows);

    return res.status(200).json({ reviews, report });
  }
);

// ── Multer error handler ──────────────────────────────────────────────────────
// Multer signals its own errors (wrong type, oversized file) via next(err).
// We catch them here and return a consistent JSON 400 instead of Express's
// default HTML error page.
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  // fileFilter rejection comes through as a plain Error
  return res.status(400).json({ error: err.message });
});

export default router;

