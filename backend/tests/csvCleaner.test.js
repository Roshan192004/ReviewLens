// Tests for csvCleaner.js and the /api/upload route.
// Run with: npm test (Vitest)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import app from "../src/server.js";
import { parseCsv, cleanReviews } from "../src/services/csvCleaner.js";
import { normalizeText, hashText } from "../src/utils/hash.js";

const __dir = dirname(fileURLToPath(import.meta.url));

// Helper: load a file as a Buffer (same as multer gives us)
function loadFixture(relPath) {
  return readFileSync(resolve(__dir, relPath));
}

// ─── 1. Real CSV: counts & data checks ─────────────────────────────────────────
describe("Real data/reviews.csv – counts and acceptance checks", () => {
  const buf = loadFixture("../../data/reviews.csv");
  const rows = parseCsv(buf);
  const { reviews, report } = cleanReviews(rows);

  it("parses exactly 30 rows", () => {
    expect(report.total_rows).toBe(30);
  });

  it("skips exactly 1 review (R005 – empty text)", () => {
    expect(report.skipped).toBe(1);
    expect(report.skipped_ids).toContain("R005");
  });

  it("detects exactly 1 duplicate (R015 is duplicate of R012)", () => {
    expect(report.duplicates).toBe(1);
    const pair = report.duplicate_pairs.find((p) => p.id === "R015");
    expect(pair).toBeDefined();
    expect(pair.duplicate_of).toBe("R012");
  });

  it("valid + skipped + duplicates === total_rows (invariant)", () => {
    expect(report.valid + report.skipped + report.duplicates).toBe(report.total_rows);
  });

  it("valid count is 28", () => {
    expect(report.valid).toBe(28);
  });

  it("R010 has rating_issue 'missing' (blank rating)", () => {
    const r = reviews.find((r) => r.review_id === "R010");
    expect(r.rating).toBeNull();
    expect(r.rating_issue).toBe("missing");
  });

  it("R022 has rating_issue 'invalid' (value was 'five')", () => {
    const r = reviews.find((r) => r.review_id === "R022");
    expect(r.rating).toBeNull();
    expect(r.rating_issue).toBe("invalid");
  });

  it("R009 (emoji-only '👍👍👍') is valid, not skipped", () => {
    const r = reviews.find((r) => r.review_id === "R009");
    expect(r.status).toBe("pending");
    expect(r.text).toBe("👍👍👍");
  });

  it("R016 (Devanagari text) is valid", () => {
    const r = reviews.find((r) => r.review_id === "R016");
    expect(r.status).toBe("pending");
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("R006 has HTML stripped (<b> tags removed)", () => {
    const r = reviews.find((r) => r.review_id === "R006");
    expect(r.text).not.toContain("<b>");
    expect(r.text).not.toContain("</b>");
    expect(r.text).toContain("Average product.");
  });
});

// ─── 2. HTML stripping & entity decoding ───────────────────────────────────────
describe("HTML stripping and entity decoding", () => {
  it("strips HTML tags", () => {
    const rows = parseCsv(Buffer.from(
      "review_id,product,rating,date,review_text\n" +
      "X1,ProdA,5,2024-01-01,<b>Love it!</b>\n"
    ));
    const { reviews } = cleanReviews(rows);
    expect(reviews[0].text).toBe("Love it!");
  });

  it("decodes HTML entities", () => {
    const rows = parseCsv(Buffer.from(
      "review_id,product,rating,date,review_text\n" +
      "X1,ProdA,4,2024-01-01,Price is &lt;100 &amp; worth it\n"
    ));
    const { reviews } = cleanReviews(rows);
    expect(reviews[0].text).toBe("Price is <100 & worth it");
  });

  it("handles double-encoded entities like &amp;lt;", () => {
    const rows = parseCsv(Buffer.from(
      "review_id,product,rating,date,review_text\n" +
      "X1,ProdA,4,2024-01-01,&amp;lt;Love this mat!&amp;gt;\n"
    ));
    const { reviews } = cleanReviews(rows);
    expect(reviews[0].text).toBe("<Love this mat!>");
  });
});

// ─── 3. Rating parsing ────────────────────────────────────────────────────────
describe("Rating parsing", () => {
  function makeRow(rating) {
    return parseCsv(Buffer.from(
      `review_id,product,rating,date,review_text\nR1,P,${rating},2024-01-01,Some text\n`
    ));
  }

  it("accepts integer string '4'", () => {
    const { reviews } = cleanReviews(makeRow("4"));
    expect(reviews[0].rating).toBe(4);
    expect(reviews[0].rating_issue).toBeNull();
  });

  it("accepts '4.0' as 4", () => {
    const { reviews } = cleanReviews(makeRow("4.0"));
    expect(reviews[0].rating).toBe(4);
    expect(reviews[0].rating_issue).toBeNull();
  });

  it("'five' → null with rating_issue 'invalid'", () => {
    const { reviews } = cleanReviews(makeRow("five"));
    expect(reviews[0].rating).toBeNull();
    expect(reviews[0].rating_issue).toBe("invalid");
  });

  it("'0' → null with 'invalid' (out of 1-5 range)", () => {
    const { reviews } = cleanReviews(makeRow("0"));
    expect(reviews[0].rating).toBeNull();
    expect(reviews[0].rating_issue).toBe("invalid");
  });

  it("blank rating → null with rating_issue 'missing'", () => {
    const rows = parseCsv(Buffer.from(
      "review_id,product,rating,date,review_text\nR1,P,,2024-01-01,Some text\n"
    ));
    const { reviews } = cleanReviews(rows);
    expect(reviews[0].rating).toBeNull();
    expect(reviews[0].rating_issue).toBe("missing");
  });
});

// ─── 4. Duplicate detection ───────────────────────────────────────────────────
describe("Duplicate detection", () => {
  it("detects exact duplicates", () => {
    const csv =
      "review_id,product,rating,date,review_text\n" +
      "A1,P,5,2024-01-01,Great product\n" +
      "A2,P,5,2024-01-02,Great product\n";
    const { report } = cleanReviews(parseCsv(Buffer.from(csv)));
    expect(report.duplicates).toBe(1);
    expect(report.duplicate_pairs[0]).toEqual({ id: "A2", duplicate_of: "A1" });
  });

  it("detects duplicates that differ only in case/whitespace", () => {
    const csv =
      "review_id,product,rating,date,review_text\n" +
      "B1,P,5,2024-01-01,Great   Product\n" +
      "B2,P,5,2024-01-02,great product\n";
    const { report } = cleanReviews(parseCsv(Buffer.from(csv)));
    expect(report.duplicates).toBe(1);
    expect(report.duplicate_pairs[0].duplicate_of).toBe("B1");
  });
});

// ─── 5. Multi-line quoted field ───────────────────────────────────────────────
describe("Multi-line quoted fields", () => {
  it("parses a quoted field containing a newline as one review", () => {
    const csv =
      'review_id,product,rating,date,review_text\n' +
      'C1,ProdA,5,2024-01-01,"This is line one\nand this is line two"\n';
    const rows = parseCsv(Buffer.from(csv));
    expect(rows).toHaveLength(1);
    const { reviews } = cleanReviews(rows);
    expect(reviews[0].text).toBe("This is line one and this is line two");
  });
});

// ─── 6. Missing required column ───────────────────────────────────────────────
describe("parseCsv – missing required columns", () => {
  it("throws an error naming the missing column", () => {
    const csv = "review_id,product,rating,date\nR1,P,5,2024-01-01\n";
    expect(() => parseCsv(Buffer.from(csv))).toThrowError(/review_text/);
  });

  it("throws an error when multiple columns are missing", () => {
    const csv = "review_id,product\nR1,P\n";
    expect(() => parseCsv(Buffer.from(csv))).toThrowError(/rating/);
  });
});

// ─── 7. Report invariant on messy input ───────────────────────────────────────
describe("Report invariant on messy input", () => {
  it("valid + skipped + duplicates === total_rows on mixed data", () => {
    const csv =
      "review_id,product,rating,date,review_text\n" +
      ",ProdA,5,2024-01-01,Normal review\n" +           // missing id → ROW-2
      "D2,ProdA,nine,2024-01-02,Another review\n" +     // invalid rating
      "D3,ProdA,3,bad-date,\n" +                        // empty text → skipped
      "D4,ProdA,3,2024-01-04,Normal review\n" +         // duplicate of ROW-2
      "D5,ProdA,3,2024-01-05,Unique review here\n";
    const rows = parseCsv(Buffer.from(csv));
    const { report } = cleanReviews(rows);
    expect(report.valid + report.skipped + report.duplicates).toBe(report.total_rows);
    expect(report.total_rows).toBe(5);
    expect(report.skipped).toBe(1);
    expect(report.duplicates).toBe(1);
    expect(report.valid).toBe(3);
  });
});

// ─── 8. normalizeText / hashText ─────────────────────────────────────────────
describe("hash utils", () => {
  it("normalizeText lowercases and collapses whitespace", () => {
    expect(normalizeText("  Hello   World  ")).toBe("hello world");
  });

  it("hashText returns a 64-char hex string", () => {
    const h = hashText("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same normalised text always gives same hash", () => {
    expect(hashText("Great product")).toBe(hashText("great   product"));
  });

  it("different texts give different hashes", () => {
    expect(hashText("good")).not.toBe(hashText("bad"));
  });
});

// ─── 9. Upload Route HTTP Tests (supertest) ──────────────────────────────────
describe("POST /api/upload endpoint", () => {
  it("responds 200 with reviews and report for real reviews.csv", async () => {
    const filePath = resolve(__dir, "../../data/reviews.csv");
    const res = await request(app)
      .post("/api/upload")
      .attach("file", filePath);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("reviews");
    expect(res.body).toHaveProperty("report");
    expect(res.body.report.total_rows).toBe(30);
    expect(res.body.report.valid).toBe(28);
    expect(res.body.report.skipped).toBe(1);
    expect(res.body.report.duplicates).toBe(1);
  });

  it("responds 400 when no file is uploaded", async () => {
    const res = await request(app)
      .post("/api/upload");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/No file uploaded/i);
  });

  it("responds 400 when CSV is missing required columns", async () => {
    const badCsv = Buffer.from("review_id,product,date\nR1,Watch,2024-01-01\n");
    const res = await request(app)
      .post("/api/upload")
      .attach("file", badCsv, "missing_columns.csv");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/missing required columns/i);
  });

  it("responds 400 when a non-csv file is uploaded", async () => {
    const textFile = Buffer.from("just some plain text");
    const res = await request(app)
      .post("/api/upload")
      .attach("file", textFile, "notes.txt");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/Only \.csv files are accepted/i);
  });
});
