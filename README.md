# Document Processing System

An async document processing pipeline where users upload documents, track live processing progress, review extracted data, edit and finalize results, and export as JSON or CSV.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Setup Instructions](#setup-instructions)
- [Run Steps](#run-steps)
- [API Endpoints](#api-endpoints)
- [Processing Pipeline](#processing-pipeline)
- [Assumptions](#assumptions)
- [Tradeoffs](#tradeoffs)
- [Limitations](#limitations)
- [AI Tools Used](#ai-tools-used)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│              React + TypeScript (port 5173)                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API + SSE
┌──────────────────────▼──────────────────────────────────────┐
│                  FastAPI Backend (port 8000)                 │
│         Routes → Services → SQLAlchemy (async)              │
└────────┬─────────────────────────────┬───────────────────────┘
         │ Dispatches task             │ Reads/Writes
         │                            │
┌────────▼──────────┐      ┌──────────▼──────────┐
│   Celery Worker   │      │     PostgreSQL        │
│  (background job) │      │  Documents + Jobs     │
└────────┬──────────┘      └─────────────────────-┘
         │ Publishes events
┌────────▼──────────┐
│       Redis        │
│  Broker + Pub/Sub  │
└────────┬──────────┘
         │ SSE stream
┌────────▼──────────┐
│   Browser (SSE)    │
│  Live progress bar │
└───────────────────┘
```

### How It Works

1. User uploads a file via the React frontend
2. FastAPI saves the file to disk and creates a DB record (status: `queued`)
3. FastAPI dispatches a Celery task and returns immediately — no blocking
4. Celery worker picks up the task and processes the document in stages
5. At each stage the worker publishes an event to Redis Pub/Sub
6. FastAPI SSE endpoint reads from Redis and streams events to the browser
7. Frontend progress bar updates in real time
8. On completion, user can review, edit, finalize, and export the result

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, React Router |
| Backend | Python 3.11, FastAPI, Uvicorn |
| ORM | SQLAlchemy 2.0 (async) |
| Background Jobs | Celery 5.4 |
| Message Broker | Redis 7 |
| Progress Streaming | Redis Pub/Sub → Server-Sent Events (SSE) |
| Database | PostgreSQL 16 |
| File Parsing | PyPDF2, python-docx |

---

## Setup Instructions

### Prerequisites

Install these before starting:

| Tool | Version | Download |
|------|---------|----------|
| Python | 3.11.x | https://www.python.org/downloads/ |
| Node.js | 20.x LTS | https://nodejs.org |
| PostgreSQL | 16.x | https://www.postgresql.org/download/windows/ |
| Redis | Latest | https://github.com/tporadowski/redis/releases |

> **Windows users:** When installing Python, check **"Add Python to PATH"**

### PostgreSQL Setup

Open SQL Shell (psql) and run:

```sql
CREATE USER "user" WITH PASSWORD 'password';
CREATE DATABASE docprocessor OWNER "user";
GRANT ALL PRIVILEGES ON DATABASE docprocessor TO "user";
\q
```

### Clone the Repository

```bash
git clone https://github.com/yourusername/doc-processor.git
cd doc-processor
```

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate (Windows Git Bash)
source venv/Scripts/activate

# Activate (Windows PowerShell)
# venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Create uploads folder
mkdir -p uploads
```

Create `backend/.env` file:

```env
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/docprocessor
SYNC_DATABASE_URL=postgresql://user:password@localhost:5432/docprocessor
REDIS_URL=redis://localhost:6379/0
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
```

### Frontend Setup

```bash
cd frontend
npm install
```

---

## Run Steps

You need **3 terminals** open at the same time.

### Terminal 1 — Backend API

```bash
cd backend
source venv/Scripts/activate       # Windows Git Bash
uvicorn main:app --reload --port 8000
```

Expected output:
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### Terminal 2 — Celery Worker

```bash
cd backend
source venv/Scripts/activate       # Windows Git Bash
celery -A app.worker.celery_app worker --loglevel=info --pool=solo
```

> `--pool=solo` is required on Windows

Expected output:
```
[INFO] celery@yourpc ready.
```

### Terminal 3 — Frontend

```bash
cd frontend
npm run dev
```

Expected output:
```
VITE ready
➜  Local:   http://localhost:5173/
```

### Open in Browser

| URL | Purpose |
|-----|---------|
| http://localhost:5173 | Main application |
| http://localhost:8000/docs | API documentation (Swagger) |
| http://localhost:8000/health | Health check |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/documents/upload` | Upload one or more files |
| `GET` | `/api/documents` | List documents (search, filter, sort, paginate) |
| `GET` | `/api/documents/{id}` | Get single document detail |
| `GET` | `/api/documents/{id}/progress` | SSE stream for live progress |
| `PATCH` | `/api/documents/{id}/review` | Save edited/reviewed data |
| `POST` | `/api/documents/{id}/finalize` | Mark document as finalized |
| `POST` | `/api/documents/{id}/retry` | Retry a failed job |
| `GET` | `/api/documents/{id}/export?format=json` | Export as JSON |
| `GET` | `/api/documents/{id}/export?format=csv` | Export as CSV |

---

## Processing Pipeline

Each document goes through these stages published via Redis Pub/Sub:

```
Upload received
     │
     ▼
job_queued (0%)
     │
     ▼
job_started (5%)
     │
     ▼
document_parsing_started (20%)
     │
     ▼
document_parsing_completed (45%)
     │
     ▼
field_extraction_started (60%)
     │
     ▼
field_extraction_completed (85%)
     │
     ▼
job_completed (100%)  ──or──  job_failed (0%)
```

### Extracted Fields

| Field | Description |
|-------|-------------|
| `title` | Derived from filename |
| `category` | Auto-classified (Financial, Legal, Report, General) |
| `summary` | Auto-generated description |
| `keywords` | Top 5 most frequent meaningful words |
| `word_count` | Total word count |
| `file_metadata` | Filename, type, size |

---

## Assumptions

- **File storage is local disk.** In production this would be replaced with AWS S3 or similar cloud storage using the same interface abstraction.

- **Processing logic is simulated.** The extraction uses keyword frequency and filename heuristics rather than a real AI/OCR model. The async architecture is real and production-grade — the business logic inside it can be swapped out.

- **Single worker node.** The system is designed to scale horizontally — more Celery workers can be added without code changes, just by running more worker processes.

- **No authentication.** Users are not authenticated. Adding JWT-based auth is straightforward as FastAPI middleware and was excluded to focus on the async workflow.

- **SSE over WebSockets.** Server-Sent Events were chosen for progress streaming because they are simpler to implement for one-way server→client communication and don't require connection upgrades. WebSockets would be needed if bidirectional communication were required.

- **Sync DB session in Celery worker.** Celery tasks use a synchronous SQLAlchemy session because Celery runs in its own process without an async event loop. The API layer uses the full async session.

---

## Tradeoffs

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Progress delivery | SSE | WebSockets / Polling | SSE is simpler, built into browsers, sufficient for one-way streaming |
| Worker DB access | Sync SQLAlchemy | Async SQLAlchemy | Celery has no async event loop by default |
| File storage | Local disk | AWS S3 | Simpler for development; abstraction makes swapping easy |
| Task retries | Celery built-in | Manual retry logic | Celery handles exponential backoff natively |
| DB migrations | SQLAlchemy auto-create | Alembic | Faster for development; Alembic recommended for production |
| Frontend state | React useState | Redux / Zustand | Scope is small enough that local state is sufficient |

---

## Limitations

- **No cloud file storage** — uploaded files are stored on local disk. If the server restarts and the disk is wiped, files are lost.
- **No authentication or authorization** — any user can see and modify any document.
- **Basic text extraction** — scanned PDFs without an OCR engine will return empty text. Only machine-readable PDFs and DOCX files are parsed.
- **No cancellation** — once a job is dispatched to Celery, it cannot be cancelled mid-processing.
- **Single machine** — Redis Pub/Sub only works on a single Redis instance. A production system would need Redis Cluster or a different pub/sub approach for multi-region.
- **Windows Celery limitation** — `--pool=solo` means only one task runs at a time on Windows. On Linux/Mac, `--concurrency=4` allows parallel processing.

---

## AI Tools Used

**Claude (Anthropic)** was used during development for:
- Initial boilerplate generation for FastAPI routes and SQLAlchemy models
- Debugging Python compatibility issues (SQLAlchemy vs Python 3.14)
- Generating the README structure

All architectural decisions, system design choices, async workflow design, and integration logic were designed and reviewed manually. The code was understood, tested, and modified throughout development — not blindly copy-pasted.
