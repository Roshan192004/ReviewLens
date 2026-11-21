# ReviewLens

ReviewLens turns product-review CSV files into persisted sentiment and topic
insights. Upload reviews, explore the results by sentiment or keyword, and draft
professional replies to customer complaints.

## Features

- CSV parsing and cleaning, including UTF-8 BOM, multiline text, HTML, and
  Unicode reviews.
- Duplicate detection, rating validation, and an upload quality report.
- Gemini 3.5 Flash-Lite sentiment, topic, summary, and reply analysis.
- Structured LLM output validation, bounded retries, and untrusted-review
  prompt boundaries.
- SQLite persistence for uploads, review results, reply suggestions, and
  prompt-versioned analysis caching.
- Responsive React dashboard with sentiment summaries, search, filters, and
  analysis status reporting.

## Requirements

- Node.js 22.13 or later
- npm
- Gemini API key for LLM analysis and reply generation

The backend and dashboard can start without an API key, but analysis requests
will be recorded as failed until `GEMINI_API_KEY` is configured.

## Run locally

Copy `.env.example` to `.env` at the repository root and add your Gemini API
key. Never commit the real `.env` file.

```powershell
Copy-Item .env.example .env
```

In the first terminal:

```powershell
Set-Location backend
npm ci
npm run dev
```

In a second terminal:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. The dashboard includes a download link to
`data/reviews.csv`, a 30-row sample dataset. The Vite development server proxies
API requests to the backend at `http://localhost:4000`.

## CSV format

The CSV header must contain these columns:

```csv
review_id,product,rating,date,review_text
```

Each `review_id` must be unique within an upload. Ratings may be blank or
integers from 1 to 5. Uploads are limited to 2 MB. Empty review text is skipped;
normalized duplicate text is reported and analyzed only once.

## API

All responses are JSON except the sample CSV download. Errors use
`{ "error": "..." }`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload one CSV as multipart field `file`; returns persisted reviews, cleaning report, and analysis stats. |
| `GET` | `/api/reviews` | Return the most recently uploaded review set. |
| `GET` | `/api/reviews?uploadId=<id>` | Retrieve a specific upload. |
| `POST` | `/api/reviews/:reviewId/reply` | Generate or retrieve a saved reply; JSON body: `{ "upload_id": "<id>" }`. |
| `GET` | `/api/sample.csv` | Download the sample CSV. |

An upload returns `201` once its results are saved. Individual LLM failures are
returned on the affected review as `analysis_failed`; successful results remain
available. Re-uploading the same review text reuses a successful analysis when
the configured `PROMPT_VERSION` has not changed.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | For LLM analysis/replies | — | Google Gemini API key |
| `PORT` | No | `4000` | Backend listen port |
| `CACHE_DB_PATH` | No | `cache.db` | SQLite database path; relative paths resolve from `backend/` |

The API key is used only by the backend and is never sent to the browser.

## Run with Docker

Docker Desktop with the Compose plugin is required. Add `GEMINI_API_KEY` to
the repository-root `.env` file if you want LLM analysis, then run:

```powershell
docker compose up --build
```

Open `http://localhost:5173`. Nginx serves the dashboard and proxies API
requests to the backend. Review data and the analysis cache persist in the
`reviewlens-data` volume. Use `docker compose down -v` only when you intend to
remove that stored data.

## Tests and build

```powershell
Set-Location backend
npm test
```

```powershell
Set-Location frontend
npm run build
```

Backend tests cover CSV cleaning, upload and retrieval APIs, persistence and
caching, LLM output validation, retries, and reply generation using mocked
providers. Tests do not require a live Gemini key.

## Project structure

```text
reviewlens/
├── backend/
│   ├── src/
│   │   ├── prompts/       # Analysis prompts and untrusted-input handling
│   │   ├── routes/        # Upload and review/reply API routes
│   │   ├── schema/        # Zod schemas for model responses
│   │   ├── services/      # Analysis, CSV cleaning, replies, and SQLite store
│   │   └── utils/         # Backoff and text hashing
│   ├── tests/             # Vitest unit and API integration tests
│   └── package.json
├── data/
│   └── reviews.csv        # Sample dataset
├── frontend/
│   ├── src/
│   │   ├── api/           # Backend fetch client
│   │   ├── App.jsx        # Upload and analysis dashboard
│   │   └── styles.css     # Responsive styles
│   └── package.json
├── .env.example
├── .gitignore
└── docker-compose.yml
```

## Limitations

- Authentication and tenant isolation are not implemented. Do not expose this
  service publicly with sensitive customer data.
- Analysis and reply generation incur Gemini API usage and are subject to
  provider quotas and availability.
- Only Gemini is implemented as an LLM provider.
