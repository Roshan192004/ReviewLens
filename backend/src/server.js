// Entry point – loads env vars and starts the Express server.
// All routes and middleware are wired here; business logic lives in services/.

import "dotenv/config";
import express from "express";
import uploadRouter from "./routes/upload.js";

const app = express();
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/upload", uploadRouter);
// TODO (Phase 7): mount /api/reviews and /api/reviews/:id/reply

const port = process.env.PORT ?? 4000;
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`[server] ReviewLens backend listening on http://localhost:${port}`);
  });
}

export default app; // exported so tests can import without calling listen()
