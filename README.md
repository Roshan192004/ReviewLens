# ReviewLens

ReviewLens is an early-stage product-review analysis project. Its current
working feature accepts a CSV upload, cleans and validates review rows, detects
duplicate review text, and returns a cleaning report from an Express API.

The repository also contains isolated LLM analysis, batching, retry, and output
validation modules. They are not yet connected to the upload endpoint. The
React frontend and production Docker setup are not implemented yet.

## Current features

- Parses CSV files with UTF-8 BOM and quoted multiline fields.
- Requires `review_id`, `product`, `rating`, `date`, and `review_text` columns.
- Cleans HTML and whitespace, preserves Unicode and emoji, and reports missing
  or invalid ratings.
- Flags empty reviews and duplicate normalized text.
- Limits CSV uploads to 2 MB.
- Provides unit and API tests for CSV cleaning, LLM analysis helpers, response
  validation, batching, and retry behavior.

## Requirements

- Node.js 20 or later
- npm
- A Gemini API key is only needed when calling the LLM analysis client; the
  current upload endpoint does not invoke it.

## Run the backend

From the repository root, install and start the backend:

```powershell
Set-Location backend
npm install
npm run dev
```

The API listens on `http://localhost:4000` by default.

### Upload a CSV

Send a `multipart/form-data` request to `POST /api/upload` with the CSV in the
`file` field. For example, from PowerShell:

```powershell
curl.exe -F "file=@..\data\reviews.csv" http://localhost:4000/api/upload
```

The response contains the cleaned `reviews` and a `report` with row, duplicate,
skip, and rating counts. The endpoint does not call an LLM.

## Run tests

```powershell
Set-Location backend
npm test
```

The tests use mocked LLM calls and do not require a live API key. The frontend
package currently has build dependencies declared, but no app entry point or UI
exists yet, so its build is not available.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Only for LLM analysis | — | Google Gemini API key |
| `PORT` | No | `4000` | Express server port |

Keep real credentials in `.env`; do not commit them. `.env.example` contains
only a placeholder.

## Project structure

```text
reviewlens/
├── backend/
│   ├── src/
│   │   ├── prompts/       # Analysis prompts and untrusted-input handling
│   │   ├── routes/        # Current CSV upload endpoint
│   │   ├── schema/        # Zod analysis schemas
│   │   ├── services/      # CSV cleaning, LLM analysis, validation, batching
│   │   ├── utils/         # Backoff and text hashing
│   │   └── server.js      # Express entry point
│   ├── tests/             # Vitest unit and API tests
│   └── package.json
├── data/
│   └── reviews.csv        # Small sample dataset
├── frontend/
│   ├── src/               # Empty scaffolding; UI is not implemented
│   └── package.json
├── .env.example
├── .gitignore
└── docker-compose.yml     # Draft; container workflow is not complete
```

## Development roadmap

1. **Core API and data flow:** connect CSV upload to validated LLM analysis,
   define consistent analysis results, and test the end-to-end backend flow.
2. **User-facing features:** build the React upload and results experience,
   connect it to the API, and add review filtering and product summaries.
3. **Release readiness:** complete persistence and error handling, make Docker
   deployment reproducible, expand integration coverage, and document verified
   setup and limitations.

## Known limitations

- Only `POST /api/upload` is implemented; there are no review-list or reply
  endpoints.
- Upload currently cleans CSV data but does not invoke the LLM analysis
  services.
- There is no frontend UI, persistent review store, or authentication.
- Dockerfiles and Compose configuration are drafts and have not been verified.
- The Gemini client is the only implemented provider; Groq is not supported.
