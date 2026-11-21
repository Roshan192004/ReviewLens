import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReviewsRouter } from "./routes/reviews.js";
import { createUploadRouter } from "./routes/upload.js";

dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
});

export function createApp({ store, analyze, createReply } = {}) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use("/api/upload", createUploadRouter({ store, analyze }));
  app.use("/api/reviews", createReviewsRouter({ store, createReply }));

  app.use((req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });

  app.use((error, _req, res, _next) => {
    const status = error instanceof multer.MulterError
      ? 400
      : Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    if (status >= 500) {
      console.error("[api] Request failed:", error);
    }
    res.status(status).json({ error: error.message || "Internal server error." });
  });

  return app;
}

const app = createApp();
const port = process.env.PORT ?? 4000;
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`[server] ReviewLens backend listening on http://localhost:${port}`);
  });
}

export default app;
