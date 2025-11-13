# Document Chat Application

A RAG (Retrieval-Augmented Generation) application that allows you to chat with documents from a local directory using Google's Gemini AI.

## Architecture

This app consists of:
- **Frontend**: React + TypeScript (Vite) running on port 3000
- **Backend**: Express server running on port 3001 that handles Gemini API calls and reads local documents

## Prerequisites

- Node.js (v18 or higher)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

## Setup

### 1. Install dependencies

Install frontend dependencies:
```bash
npm install
```

Install backend dependencies:
```bash
cd server
npm install
cd ..
```

### 2. Configure the backend

Edit `server/.env` and set:
- `GEMINI_API_KEY`: Your Gemini API key
- `DOCUMENTS_DIR`: Path to your documents directory (default: `/Users/aneal/Library/CloudStorage/OneDrive-UniversityofEdinburgh/national_security_analysis/gemini_PDF_processor/output/clean_final`)

Example:
```bash
GEMINI_API_KEY=your_actual_api_key_here
DOCUMENTS_DIR=/path/to/your/documents
PORT=3001
```

### 3. Run the application

You need to run both the backend and frontend:

**Terminal 1 - Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## How it works

1. **First startup**: The app automatically loads all documents from the configured directory and creates a persistent RAG store (5-10 minutes for 607 documents)
2. **Subsequent startups**: The app uses the cached RAG store and loads instantly (2-3 seconds)
3. You can chat with the documents - the AI will search through them to answer your questions
4. **Clear Chat** button: Clears the conversation history but keeps the documents loaded
5. **Reload** button: Forces re-upload of all documents from the directory (use this if you add new documents to the folder)

## Supported File Formats

- `.txt` - Plain text
- `.pdf` - PDF documents
- `.doc`, `.docx` - Word documents
- `.md` - Markdown
- `.html` - HTML files
- `.json` - JSON files
