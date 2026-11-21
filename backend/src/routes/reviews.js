import { Router } from "express";
import { generateReply } from "../services/replyGenerator.js";
import { getReviewStore } from "../services/reviewStore.js";

export function createReviewsRouter({
  store,
  createReply = generateReply,
} = {}) {
  const router = Router();

  router.get("/", (req, res) => {
    const activeStore = store || getReviewStore();
    const uploadId = req.query.uploadId;
    const upload = uploadId
      ? activeStore.getUpload(uploadId)
      : activeStore.getLatestUpload();

    if (uploadId && !upload) {
      return res.status(404).json({ error: "Upload not found." });
    }

    return res.status(200).json(
      upload || { upload_id: null, reviews: [] },
    );
  });

  router.post("/:reviewId/reply", async (req, res, next) => {
    const activeStore = store || getReviewStore();
    const uploadId = req.body?.upload_id;
    if (typeof uploadId !== "string" || !uploadId.trim()) {
      return res.status(400).json({ error: "upload_id is required." });
    }

    const review = activeStore.getReview(uploadId, req.params.reviewId);
    if (!review) {
      return res.status(404).json({ error: "Review not found." });
    }
    if (review.status !== "analysed" || !review.analysis_json) {
      return res.status(409).json({
        error: "A reply can only be generated for an analyzed review.",
      });
    }

    const existing = activeStore.getReply(uploadId, req.params.reviewId);
    if (existing) {
      return res.status(200).json({
        review_id: review.review_id,
        reply: existing.reply,
        created_at: existing.created_at,
        cached: true,
      });
    }

    try {
      const reply = await createReply({
        review_id: review.review_id,
        product: review.product,
        text: review.text,
        analysis: JSON.parse(review.analysis_json),
      });
      const saved = activeStore.saveReply(uploadId, req.params.reviewId, reply);
      return res.status(201).json({
        review_id: review.review_id,
        ...saved,
        cached: false,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createReviewsRouter;
