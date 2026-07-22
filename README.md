# 🛡️ DevSecOps AI Code Reviewer — Fullstack Repository

A high-performance, real-time AI security audit system designed to detect OWASP Top 10 vulnerabilities in code snippets. The application consists of an Express & TypeScript backend API and a Next.js (App Router) & Monaco Editor frontend.

---

## 🏗️ System Architecture & Data Flow

```text
                  ┌────────────────────────────────────────┐
                  │    Next.js Client (HTTP POST Stream)   │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │ 1. Upstash Redis Rate Limiter          │
                  │    (Sliding Token Bucket: 5 req/min)   │
                  └───────────────────┬────────────────────┘
                                      │
                    ┌──────────────────┴──────────────────┐
              [ALLOWED]                               [EXCEEDED]
                    │                                     │
                    ▼                                     ▼
  ┌──────────────────────────────────┐          ┌───────────────────┐
  │ 2. Semantic Cache Check          │          │ Return HTTP 429   │
  │    (Pinecone Vector DB - 3072D)  │          │ Rate Limit Error  │
  └─────────────────┬────────────────┘          └───────────────────┘
                    │
      ┌─────────────┴─────────────┐
      │                           │
 [CACHE HIT]             [CACHE MISS / TIMEOUT]
 (≤ 50ms)                             │
 │                           ▼
 │             ┌───────────────────────────────────┐
 │             │ 3. Gemini 3.5 Flash LLM Engine     │
 │             │    (SSE Structured JSON Stream)   │
 │             └─────────────────┬─────────────────┘
 │                               │
 ▼                               ▼
 ┌──────────────────────────────────────────────────────────┐
 │ 4. Client Response & Background Persistence (onFinish)  │
 │    - Stream Live Tokens to Frontend Client               │
 │    - Save Audit Log to MongoDB Atlas                     │
 │    - Generate Vector Embedding & UPSERT to Pinecone      │
 └──────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features

### Backend API
* **Server-Sent Events (SSE):** Real-time JSON token streaming directly from Gemini 3.5 Flash.
* **Semantic Vector Caching:** Pinecone vector database detects semantically equivalent code snippets ($\ge 0.96$ cosine similarity) to serve cached reviews in $\le 50\text{ms}$.
* **Adaptive Fallback Timeout:** A non-blocking 3000ms race promise prevents database network delays from freezing the client stream.
* **Write-through Cache:** The `onFinish` stream handler automatically embeds the source code via `gemini-embedding-001` and upserts the result to Pinecone for future cache hits.
* **DDoS & Rate Protection:** Upstash Redis token-bucket middleware caps endpoint traffic to 5 requests per minute per IP.
* **Audit Persistence:** Stores code review results and execution history in MongoDB Atlas.

### Frontend Dashboard
* **Instant UI Hydration:** The loading screen disappears as soon as *any* partial stream data (such as score or issues) starts arriving, rather than waiting for the entire summary.
* **Monaco Editor Integration:** Embedded VS Code editor layout with dynamic line decorations highlighting security warnings and critical issues in real-time.
* **Interactive Patch Previews:** Side-by-side Git-style diff views for comparing code before and after applying the suggested security fixes.

---

## 📁 Repository Structure

### 🇎 Backend (`/ai-reviewer-backend`)
```text
ai-reviewer-backend/
├── src/
│   ├── config/
│   │   ├── env.ts             # Zod-validated environment variables
│   │   └── database.ts        # MongoDB Atlas & Redis connections
│   ├── modules/
│   │   └── review/
│   │       ├── review.controller.ts  # Express HTTP route handler
│   │       ├── review.model.ts       # Mongoose Audit Schema
│   │       ├── review.schema.ts      # Zod Output Validation & System Prompts
│   │       └── review.service.ts     # Pinecone Cache & Gemini Stream Logic
│   └── shared/
│       ├── middleware/        # Upstash Redis Rate Limiting Middleware
│       └── utils/             # Winston Structured Logger
├── package.json
└── tsconfig.json
```

### 💻 Frontend (`/ai-reviewer-frontend`)
```text
ai-reviewer-frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Main HTML wrapper & fonts
│   │   ├── globals.css        # Tailwind utility overrides
│   │   └── page.tsx           # Dashboard view orchestrating state
│   ├── components/
│   │   ├── CodeEditor.tsx     # Monaco Editor & Diff Editor wrappers
│   │   └── SecurityPanel.tsx  # Interactive security score and issues panel
│   └── lib/
│       └── types.ts           # Schema and TypeScript declarations
├── package.json
└── tsconfig.json
```

---

## ⚙️ Environment Configuration

### Backend `.env` Setup
Create a `.env` file in the `/ai-reviewer-backend` directory:
```text
PORT=5001
NODE_ENV=development

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/ai-reviewer

# Google Gemini AI
GEMINI_API_KEY=your_gemini_api_key_here

# Pinecone Vector DB
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX_NAME=code-reviews

# Upstash Redis Rate Limiting
UPSTASH_REDIS_REST_URL=your_upstash_redis_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
```

> [!NOTE]
> Ensure your Pinecone index is configured with **3072 dimensions** and **Cosine** metric to match `gemini-embedding-001`.

### Frontend `.env.local` Setup
Create a `.env.local` file in the `/ai-reviewer-frontend` directory:
```text
NEXT_PUBLIC_API_URL=http://localhost:5001
```

---

## 🚦 Getting Started

### 1. Run the Backend API
```bash
cd ai-reviewer-backend
npm install
npm run dev
```
The server will initialize on **http://localhost:5001**.

### 2. Run the Next.js Client
```bash
cd ai-reviewer-frontend
npm install
npm run dev
```
The application will be accessible at **http://localhost:3000**.

---

## 🔌 API Reference

### `POST /api/v1/review`
Streams an OWASP security review for the provided code snippet using Server-Sent Events (SSE).

* **Request Headers:**
  ```http
  Content-Type: application/json
  ```
* **Request Body:**
  ```json
  {
    "code": "function login(user, pass) { let q = 'SELECT * FROM users WHERE user=' + user; return db.execute(q); }",
    "language": "javascript"
  }
  ```
* **Response:** `text/event-stream` returning chunked JSON tokens matching `CodeReviewSchema`.
