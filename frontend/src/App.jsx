import { useEffect, useMemo, useState } from "react";
import { generateReply, getReviews, uploadReviews } from "./api/client.js";

const filters = [
  { id: "all", label: "All reviews" },
  { id: "positive", label: "Positive" },
  { id: "neutral", label: "Neutral" },
  { id: "negative", label: "Negative" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "analysis_failed", label: "Analysis issues" },
];

function Metric({ label, value, note, tone }) {
  return (
    <article className={`metric-card ${tone || ""}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-note">{note}</span>
    </article>
  );
}

function SentimentBreakdown({ reviews }) {
  const counts = ["positive", "neutral", "negative"].map((sentiment) => ({
    sentiment,
    count: reviews.filter((review) => review.analysis?.sentiment === sentiment).length,
  }));
  const total = Math.max(1, counts.reduce((sum, item) => sum + item.count, 0));

  return (
    <section className="panel sentiment-panel" aria-labelledby="sentiment-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">CUSTOMER MOOD</p>
          <h2 id="sentiment-heading">Sentiment overview</h2>
        </div>
        <span className="quiet-label">{counts.reduce((sum, item) => sum + item.count, 0)} analyzed</span>
      </div>
      <div className="sentiment-list">
        {counts.map(({ sentiment, count }) => (
          <div className="sentiment-row" key={sentiment}>
            <div className="sentiment-label">
              <span className={`sentiment-dot ${sentiment}`} />
              <span>{sentiment[0].toUpperCase() + sentiment.slice(1)}</span>
              <strong>{count}</strong>
            </div>
            <div
              className="sentiment-track"
              role="progressbar"
              aria-label={`${sentiment} reviews`}
              aria-valuenow={count}
              aria-valuemin="0"
              aria-valuemax={total}
            >
              <span
                className={`sentiment-fill ${sentiment}`}
                style={{ width: `${(count / total) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewCard({ review, uploadId, reply, replyBusy, onReply }) {
  const sentiment = review.analysis?.sentiment || review.status;
  const rating = Number.isInteger(review.rating) ? `${review.rating}/5` : "No rating";

  return (
    <article className="review-card">
      <div className="review-card-top">
        <div className="review-product">
          <span className="product-mark" aria-hidden="true">{review.product.slice(0, 1).toUpperCase()}</span>
          <div>
            <h3>{review.product}</h3>
            <p>{review.review_id}{review.date ? ` · ${review.date}` : ""}</p>
          </div>
        </div>
        <span className={`badge ${sentiment}`}>{sentiment.replace("_", " ")}</span>
      </div>

      <div className="review-rating" aria-label={`Rating: ${rating}`}>
        <span aria-hidden="true">{review.rating ? "★".repeat(review.rating) : "—"}</span>
        <span>{rating}</span>
      </div>

      <p className="review-text">{review.text || "This row did not contain review text."}</p>

      {review.analysis && (
        <div className="analysis-result">
          <p className="analysis-summary">{review.analysis.summary}</p>
          <div className="topic-list" aria-label="Review topics">
            {review.analysis.topics.map((topic) => (
              <span className="topic-chip" key={topic}>{topic.replace("_", " ")}</span>
            ))}
          </div>
        </div>
      )}

      {review.suspicious_input && (
        <p className="inline-warning">This review contains instruction-like text and was treated as untrusted data.</p>
      )}
      {review.status === "analysis_failed" && (
        <p className="inline-error">{review.error || "Analysis could not be completed."}</p>
      )}
      {review.status === "duplicate" && (
        <p className="inline-note">Duplicate of {review.duplicate_of}.</p>
      )}
      {review.status === "skipped" && (
        <p className="inline-note">Skipped: {review.skip_reason?.replace("_", " ") || "no review text"}.</p>
      )}

      {review.analysis?.needs_reply && (
        <div className="reply-area">
          {reply ? (
            <div className="reply-suggestion">
              <span className="reply-label">SUGGESTED RESPONSE</span>
              <p>{reply}</p>
            </div>
          ) : (
            <button
              className="reply-button"
              type="button"
              disabled={replyBusy}
              onClick={() => onReply(review.review_id, uploadId)}
            >
              {replyBusy ? "Drafting a response…" : "Draft a reply"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [upload, setUpload] = useState(null);
  const [booting, setBooting] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [replies, setReplies] = useState({});
  const [replyBusy, setReplyBusy] = useState({});

  useEffect(() => {
    let active = true;
    getReviews()
      .then((latest) => {
        if (active && latest.upload_id) setUpload(latest);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const reviews = upload?.reviews || [];
  const analyzed = reviews.filter((review) => review.status === "analysed");
  const failed = reviews.filter((review) => review.status === "analysis_failed");
  const missingApiKey = failed.some((review) => review.error?.includes("GEMINI_API_KEY"));
  const failureMessage = failed[0]?.error || "Analysis could not be completed.";
  const needsReply = reviews.filter((review) => review.analysis?.needs_reply).length;
  const rated = reviews.filter((review) => Number.isInteger(review.rating));
  const averageRating = rated.length
    ? (rated.reduce((total, review) => total + review.rating, 0) / rated.length).toFixed(1)
    : "—";

  const visibleReviews = useMemo(() => {
    const search = query.trim().toLowerCase();
    return reviews.filter((review) => {
      const matchesFilter = filter === "all"
        || (filter === "needs_reply" && review.analysis?.needs_reply)
        || (filter === "analysis_failed" && review.status === "analysis_failed")
        || review.analysis?.sentiment === filter;
      const matchesSearch = !search
        || [review.review_id, review.product, review.text, review.analysis?.summary]
          .some((value) => value?.toLowerCase().includes(search));
      return matchesFilter && matchesSearch;
    });
  }, [filter, query, reviews]);

  async function handleUpload(file) {
    if (!file || uploading) return;
    setError("");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a .csv file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("This file is larger than the 2 MB upload limit.");
      return;
    }

    setUploading(true);
    try {
      const result = await uploadReviews(file);
      setUpload(result);
      setReplies({});
      setFilter("all");
      setQuery("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleReply(reviewId, uploadId) {
    setError("");
    setReplyBusy((current) => ({ ...current, [reviewId]: true }));
    try {
      const result = await generateReply(reviewId, uploadId);
      setReplies((current) => ({ ...current, [reviewId]: result.reply }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReplyBusy((current) => ({ ...current, [reviewId]: false }));
    }
  }

  const fileInput = (
    <input
      className="file-input"
      type="file"
      accept=".csv,text/csv"
      disabled={uploading}
      aria-label="Choose a reviews CSV file"
      onChange={(event) => {
        void handleUpload(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ReviewLens home">
          <span className="brand-icon" aria-hidden="true">R</span>
          <span>Review<span className="brand-light">Lens</span></span>
        </a>
        <div className="topbar-status">
          <span className={`status-indicator ${booting ? "checking" : ""}`} />
          {booting ? "Connecting" : "Workspace"}
        </div>
      </header>

      <main className="page-content">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">CUSTOMER VOICE, MADE CLEAR</p>
            <h1>See the story behind every review.</h1>
            <p className="welcome-copy">
              Find product patterns, understand customer sentiment, and know what deserves a response.
            </p>
          </div>
          {upload?.created_at && (
            <div className="last-updated">
              <span>LAST ANALYSIS</span>
              <strong>{new Date(upload.created_at).toLocaleString()}</strong>
            </div>
          )}
        </section>

        <section
          className={`upload-panel ${uploading ? "is-uploading" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!uploading) void handleUpload(event.dataTransfer.files?.[0]);
          }}
          aria-label="Upload product reviews"
        >
          <div className="upload-icon" aria-hidden="true">↑</div>
          <div className="upload-copy">
            <h2>{uploading ? "Analyzing your reviews…" : "Drop your review CSV here"}</h2>
            <p>Use the sample file or your own CSV. Maximum file size: 2 MB.</p>
          </div>
          <label className="primary-button">
            {uploading ? <span className="spinner" aria-hidden="true" /> : null}
            {uploading ? "Please wait" : "Choose CSV"}
            {fileInput}
          </label>
          {uploading && <div className="upload-progress" aria-hidden="true"><span /></div>}
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button>
          </div>
        )}

        {upload && (
          <>
            {failed.length > 0 && (
              <div className="notice-banner" role="status">
                <strong>{failed.length} {failed.length === 1 ? "review needs" : "reviews need"} attention.</strong>
                {" "}{failureMessage}{/[.!?]$/.test(failureMessage) ? "" : "."}
                {missingApiKey
                  ? " Add GEMINI_API_KEY to the repository's .env file and restart the backend."
                  : ""}
              </div>
            )}

            <section className="metrics-grid" aria-label="Review summary">
              <Metric
                label="Reviews in file"
                value={upload.report?.total_rows ?? reviews.length}
                note={`${upload.report?.valid ?? analyzed.length} unique reviews`}
                tone="metric-purple"
              />
              <Metric
                label="Analyzed"
                value={analyzed.length}
                note={`${upload.stats?.cacheHits || 0} served from cache`}
                tone="metric-green"
              />
              <Metric
                label="Average rating"
                value={averageRating}
                note={`${rated.length} reviews with a rating`}
                tone="metric-amber"
              />
              <Metric
                label="Need a response"
                value={needsReply}
                note="Complaints and open issues"
                tone="metric-rose"
              />
            </section>

            <section className="dashboard-grid">
              <SentimentBreakdown reviews={reviews} />
              <section className="panel upload-details" aria-labelledby="details-heading">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">DATA QUALITY</p>
                    <h2 id="details-heading">Upload details</h2>
                  </div>
                </div>
                <div className="detail-list">
                  <div><span>Skipped empty rows</span><strong>{upload.report?.skipped || 0}</strong></div>
                  <div><span>Duplicate reviews</span><strong>{upload.report?.duplicates || 0}</strong></div>
                  <div><span>Missing ratings</span><strong>{upload.report?.missing_ratings || 0}</strong></div>
                  <div><span>Invalid ratings</span><strong>{upload.report?.invalid_ratings || 0}</strong></div>
                </div>
                <p className="source-file">Source: <strong>{upload.filename || "Uploaded CSV"}</strong></p>
              </section>
            </section>

            <section className="reviews-section" aria-labelledby="reviews-heading">
              <div className="reviews-heading">
                <div>
                  <p className="eyebrow">REVIEW EXPLORER</p>
                  <h2 id="reviews-heading">What customers are saying</h2>
                </div>
                <label className="search-box">
                  <span className="search-icon" aria-hidden="true">⌕</span>
                  <span className="visually-hidden">Search reviews</span>
                  <input
                    type="search"
                    placeholder="Search reviews"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              <div className="filter-list" role="group" aria-label="Filter reviews">
                {filters.map((item) => (
                  <button
                    className={`filter-button ${filter === item.id ? "active" : ""}`}
                    key={item.id}
                    type="button"
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {visibleReviews.length > 0 ? (
                <div className="review-list">
                  {visibleReviews.map((review) => (
                    <ReviewCard
                      key={review.review_id}
                      review={review}
                      uploadId={upload.upload_id}
                      reply={replies[review.review_id]}
                      replyBusy={Boolean(replyBusy[review.review_id])}
                      onReply={handleReply}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-filter">
                  <strong>No reviews match this view.</strong>
                  <span>Try another filter or search term.</span>
                </div>
              )}
            </section>
          </>
        )}

        {!upload && !booting && (
          <section className="empty-state">
            <div className="empty-illustration" aria-hidden="true">
              <span>“</span><span>★</span><span>”</span>
            </div>
            <h2>Your review insights will appear here.</h2>
            <p>Upload a CSV to uncover sentiment, recurring themes, and customer issues.</p>
            <a href="/api/sample.csv" download>Download the sample CSV</a>
          </section>
        )}
      </main>
      <footer className="page-footer">
        <span>ReviewLens</span>
        <span>Reviews are analyzed as untrusted customer data.</span>
      </footer>
    </div>
  );
}
