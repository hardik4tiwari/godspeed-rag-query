#  Embed GS Documentation in a Vector DB + RAG Agent in Godspeed Framework

A pluggable Retrieval-Augmented Generation (RAG) query system built using the Godspeed framework. This repo showcases dynamic API-backed natural language querying over GitHub repositories, with GitOps-driven change tracking using file hashes and commit history.

---

## 🔍 Project Purpose

This project enables querying code or knowledge from any GitHub repository by combining:
- **File and Commit Hash-Based Change Tracking**: Ensures only updated files are parsed or ingested.
- **RAG Agents**: Serve as natural language agents for semantic information retrieval from repositories.
- **Godspeed Event-Driven Workflows**: API routes are defined declaratively and connected to business logic via YAML and native JS/TS.

---

## 📂 Key Workflow Highlights

### 🔁 Event & Workflow Structure

Under `src/events` and `src/functions`:
- **Event files** (YAML) define API endpoints with `fn` mappings, input schemas, and response types.
- **Function files** (YAML or `.ts`) describe tasks in a sequential workflow DAG.


---

### 📘 Methodologies Used

#### ✅ Repository Change Tracking

- The project uses commit metadata and file hashes to detect diffs and limit processing only to changed files.
- This design significantly optimizes token usage in vector embedding or language modeling.

#### 🔧 `set_repo` Function

- Sets the target GitHub repository URL and initializes context for subsequent RAG execution.

#### 🤖 RAG Agent Flow

1. **User Query + Repo** passed via POST.
2. **set_repo** initializes source context.
3. **RAG agent** identifies and queries relevant semantic segments.
4. Returns an answer with traceable file references and hashes.

---

## 🚀 Getting Started

### 1. Clone the Repo
```bash
git clone https://github.com/hardik4tiwari/godspeed-rag-query
cd godspeed-rag-query
```

### 2. Run the Project

#### Option A (if it works out of the box):
```bash
godspeed serve
```

#### Option B (recommended fallback):
```bash
godspeed build
godspeed serve
```

---

## 🔐 Environment Variables

To run the project, you need to configure your environment variables. In the `.env` file in the project root, add the following:

```env
# .env
GEMINI_API_KEY=your_gemini_api_key_here

## 📥 Input Format (via Events)

All routes follow Godspeed’s CloudEvent format defined in `src/events/*.yaml`. The expected structure typically looks like:

```json
{
  "repoUrl": "https://github.com/owner/repo/tree/branch"
}
```

Supported endpoints can be discovered via Swagger UI (auto-generated when project is running).

---

## 📁 Folder Structure

```
src/
├── datasources/
├── .env
├── events/
│   └── set_repo.yaml
│   └── rag.yaml
├── functions/
│   ├── query_rag.ts
│   └── set_repo.ts
│   └── upsert_docs.ts
└── mappings/
```

---

## 🧠 Tech Stack

- **Godspeed Core**: Workflow execution engine.
- **Node.js / Bun.js**: Native runtime.
- **Custom Plugins**: For GitHub repo handling and RAG operations.
- **AJV**: Event & workflow schema validation.

---

## 🙌 Contributing

If you want to add new query functions or embed other data sources:
- Add event spec under `src/events`
- Add logic in `src/functions` (YAML or `.ts`)
- Ensure proper validation schema and logging

---
