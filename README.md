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
* **Real-time Dispute Chat Tab:** A fully functional side chat panel connecting directly to the server via WebSockets for querying the AI review agent about specific recommendations.

---

## 🧠 Advanced Production-Grade Features (Agentic & Hybrid Architectures)

We extended both the backend and frontend with five advanced architectural patterns, implemented 100% free using open-source packages:

### 1. Multi-Agent Collaborative Review (Agentic Architecture)
* **Approach**: Instead of using a single system prompt, we split the review responsibilities across specialized agent personas:
  - **Security Agent**: Specializes in finding vulnerabilities (OWASP, SQL Injection, secrets leakage).
  - **Performance/Style Agent**: Targets algorithm complexity ($O(N^2)$), resource leaks, naming, and clean code principles.
  - **Synthesizer Agent**: Aggregates the concurrent findings, removes overlapping reports, resolves conflicts, and generates the final code score.
* **Output / Help**: By using `Promise.all` to query specialized agents concurrently, we obtain extremely deep, comprehensive domain audits with zero added latency, reducing LLM hallucination.

### 2. AST-Based Static Analysis & Pre-Filtering (Hybrid AI + Rules)
* **Approach**: Parsed source code into an **Abstract Syntax Tree (AST)** on the server using `@babel/parser` before hitting the LLM. It runs deterministic check rules:
  - Flagging `eval()` execution calls.
  - Swallowed exception catching (empty catch blocks).
  - Loop nesting depths exceeding 3 levels.
  - Leftover debug statements (`console.log`).
  - Hardcoded credential formats.
* **Output / Help**: Provides an instant rule-check pass, pre-filtering standard errors and prepending them to the Synthesizer LLM prompt to assure structural rule enforcement.

### 3. GitHub App Integration (Inline PR Reviewer)
* **Approach**: Constructed an event webhook receiver (`POST /api/v1/webhook/github-app`) to interface GitHub App webhooks. When a PR is opened or synchronized:
  - Verifies the webhook signature using cryptographic HMAC verification.
  - Dynamically fetches the PR diff from GitHub using `octokit`.
  - Runs the AI multi-agent review on the changed line additions.
  - Submits code reviews using inline line-by-line annotations directly on the pull request.
* **Output / Help**: Automates the code auditing process in production, reviewing and commenting directly on the code diff in the developer's normal workflow.

### 4. RAG-Based Project Rule Enforcement (Context-Aware Reviews)
* **Approach**: Implemented a Retrieval-Augmented Generation (RAG) pipeline:
  - Defined guidelines in [rules.md](file:///Users/ketangurjar14/Projects/ai-reviewer-backend/rules.md).
  - Parsed, embedded, and seeded the guidelines as vectors into Pinecone indexed with a `{ type: 'rule' }` metadata marker.
  - Runs a cosine similarity search against repository rules during the review request and feeds the matched rules to the Synthesizer.
* **Output / Help**: Assures the AI review doesn't check in a vacuum, but respects and enforces repository-specific architectural rules and style constraints.

### 5. Live WebSocket Chat for Review Disputes (Interactive Agent)
* **Approach**: Connected client and server via a real-time WebSocket connection using `socket.io` and `socket.io-client`:
  - Standardized chat room spaces mapped per `reviewId`.
  - Streams conversational replies chunk-by-chunk using Vercel AI SDK's `streamText`.
* **Output / Help**: Allows the developer to discuss suggestions with the AI review agent, debug code in real-time, or request explanation on security recommendations.

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
│   │   ├── review/
│   │   │   ├── review.controller.ts  # Express HTTP route handler
│   │   │   ├── review.model.ts       # Mongoose Audit Schema
│   │   │   ├── review.schema.ts      # Zod Output Validation & System Prompts
│   │   │   ├── review.socket.ts      # WebSocket Chat Connection Manager
│   │   │   └── review.service.ts     # Pinecone Cache, RAG Rules & LLM Streaming
│   │   └── webhook/
│   │       ├── webhook.controller.ts # GitHub Actions & GitHub App handler
│   │       └── webhook.routes.ts     # Webhook POST route mounting
│   └── shared/
│       ├── middleware/        # Upstash Redis Rate Limiting Middleware
│       └── utils/             # AST Parser & Winston Structured Logger
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
│   │   └── page.tsx           # Dashboard view orchestrating tabs and state
│   ├── components/
│   │   ├── CodeEditor.tsx     # Monaco Editor & Diff Editor wrappers
│   │   ├── SecurityPanel.tsx  # Interactive security audit list
│   │   └── DiscussionsPanel.tsx # WebSocket chat interface
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

# GitHub Action Integration Secret
GITHUB_ACTION_SECRET=your_github_action_secret

# Optional GitHub App Credentials (for Inline PR Review)
GITHUB_APP_ID=your_github_app_id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=your_github_app_webhook_secret
```

> [!NOTE]
> Ensure your Pinecone index is configured with **1536 dimensions** and **Cosine** metric to match `gemini-embedding-001`.

### Frontend `.env.local` Setup
Create a `.env.local` file in the `/ai-reviewer-frontend` directory:
```text
NEXT_PUBLIC_BACKEND_URL=http://localhost:5001/api/v1/review
NEXT_PUBLIC_SOCKET_URL=http://localhost:5001
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
