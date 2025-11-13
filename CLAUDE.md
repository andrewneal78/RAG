# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A RAG (Retrieval-Augmented Generation) application that automatically loads documents from a local directory and allows users to chat with them. The app uses Google's Gemini AI with FileSearch capabilities to perform document-based Q&A.

## Architecture

The application has a client-server architecture:

- **Frontend** (port 3000): React + TypeScript (Vite)
- **Backend** (port 3001): Express server that handles Gemini API calls and reads documents from the filesystem

## Development Commands

**Frontend:**
```bash
# Install dependencies
npm install

# Run development server (localhost:3000)
npm run dev

# Build for production
npm run build
```

**Backend:**
```bash
# Install dependencies
cd server && npm install

# Run development server (localhost:3001)
npm run dev

# Build for production
npm run build
```

## Environment Configuration

The backend requires a `GEMINI_API_KEY` and `DOCUMENTS_DIR` set in `server/.env`:

```
GEMINI_API_KEY=your_api_key_here
DOCUMENTS_DIR=/path/to/your/documents
PORT=3001
```

## Architecture

### Core Flow

1. **Initialization** (`App.tsx:99-101`): On component mount, automatically calls `loadDocuments()`
2. **Document Loading** (Backend `server/src/server.ts:42-122`):
   - Backend checks if persistent RAG store exists (name: `national-security-documents-store`)
   - If exists and not force reload: Uses cached store (instant load)
   - If new or force reload:
     - Reads all supported files from `DOCUMENTS_DIR`
     - Creates/updates the RAG store
     - Uploads files and generates embeddings via Gemini API
     - Generates example questions based on document content
   - Streams progress updates to frontend via Server-Sent Events (SSE)
3. **Chat Phase** (`App.tsx:116-145`): User queries are sent to backend, which forwards them to Gemini with FileSearch tool. Responses include grounding chunks showing source material
4. **Persistence**: RAG store is **permanent** and persists across sessions
   - No automatic deletion on page close or chat end
   - "Clear Chat" button only clears conversation history
   - "Reload" button forces re-upload of all documents from directory

### Key Components

**Frontend:**
- **App.tsx**: Main orchestrator managing app state machine (`AppStatus` enum: Uploading → Chatting → Error)
- **services/geminiService.ts**: API client that calls backend endpoints
  - `createRagStoreAndUploadDocuments()`: SSE-based document loading with progress updates
  - `fileSearch()`: Query the RAG store via backend
  - `deleteRagStore()`: Cleanup RAG store
- **ChatInterface.tsx**: Handles conversation UI and message rendering

**Backend:**
- **server/src/server.ts**: Express server with three main endpoints:
  - `POST /api/rag-store/create`: Creates RAG store and uploads documents from directory (uses SSE for progress)
  - `POST /api/rag-store/query`: Queries the RAG store
  - `DELETE /api/rag-store/:ragStoreName`: Deletes a RAG store
- **server/src/geminiService.ts**: All Gemini API interactions
  - Uses `gemini-2.5-flash` model for both queries and example question generation
  - Implements polling-based upload completion with 3-second delays
  - `uploadDirectoryToRagStore()`: Reads filesystem and uploads all supported documents
  - Queries are augmented with instruction: "DO NOT ASK THE USER TO READ THE MANUAL, pinpoint the relevant sections in the response itself"
  - Supported formats: .txt, .pdf, .doc, .docx, .md, .html, .json

### State Management

State is managed via React hooks in `App.tsx`. Important refs:
- `ragStoreNameRef`: Used to ensure cleanup runs with latest store name during async operations

### Backend Configuration

The backend reads configuration from environment variables:
- `GEMINI_API_KEY`: Gemini API key (required)
- `DOCUMENTS_DIR`: Path to directory containing documents to load
- `PORT`: Server port (default: 3001)

### Types

All TypeScript interfaces are defined in `types.ts`:
- `RagStore`, `Document`: Gemini RAG store entities
- `ChatMessage`: Conversation history with optional grounding chunks
- `QueryResult`: Response from file search queries
- `AppStatus`: App state machine enum

## Important Implementation Details

- **Persistent Storage**: RAG store uses a fixed name `national-security-documents-store` and persists across sessions
- **Cached Loading**: Second startup loads instantly using existing RAG store (no re-upload needed)
- **Force Reload**: "Reload" button in UI triggers `forceReload=true` to re-upload all documents
- The upload process shows different icons for each phase
- Document name shows "(cached)" when using existing RAG store
- Example questions are parsed from JSON with fallback handling for both old (string array) and new (product + questions) formats
- File upload operations use polling with 3-second delays to check completion status
- Progress updates from backend to frontend use Server-Sent Events (SSE) for real-time feedback
- Documents directory is read synchronously on the backend using Node.js `fs` module
- Backend stores RAG store name mapping in memory (could be moved to database for production)

## Error Handling

Errors during document loading or querying display an error screen with "Try Again" button that reloads documents from the directory.
