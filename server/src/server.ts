/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as geminiService from './geminiService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure document directory from environment
const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR || '/Users/aneal/Library/CloudStorage/OneDrive-UniversityofEdinburgh/national_security_analysis/gemini_PDF_processor/output/clean_final';
const RAG_STORE_NAME = 'national-security-documents-store';

app.use(cors());
app.use(express.json());

// Store active RAG stores (in production, use a proper database)
const activeStores = new Map<string, string>();

// Lock to prevent concurrent RAG store creation
let ragStoreCreationLock = false;
const waitingRequests: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

async function acquireRagStoreLock(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!ragStoreCreationLock) {
            ragStoreCreationLock = true;
            resolve();
        } else {
            waitingRequests.push({ resolve, reject });
        }
    });
}

function releaseRagStoreLock(): void {
    if (waitingRequests.length > 0) {
        const next = waitingRequests.shift();
        next?.resolve();
    } else {
        ragStoreCreationLock = false;
    }
}

// Initialize Gemini
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('GEMINI_API_KEY not found in environment variables');
    process.exit(1);
}

geminiService.initialize(apiKey);
console.log('Gemini AI initialized');
console.log(`Documents directory: ${DOCUMENTS_DIR}`);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', documentsDir: DOCUMENTS_DIR });
});

// Check document count in current RAG store
app.get('/api/rag-store/status', async (req, res) => {
    try {
        const { ragStoreName, isNew } = await geminiService.getOrCreateRagStore(RAG_STORE_NAME);
        const stores = await geminiService.listRagStores();
        const currentStore = stores.find(s => s.name === ragStoreName);

        // Get detailed info from local tracker
        const trackedFiles = geminiService.getUploadedFilesList(ragStoreName);
        const trackedCount = trackedFiles.length;

        // Check for duplicates in the tracker
        const fileSet = new Set(trackedFiles);
        const hasDuplicates = fileSet.size !== trackedFiles.length;
        const duplicateCount = trackedFiles.length - fileSet.size;

        res.json({
            storeName: ragStoreName,
            displayName: RAG_STORE_NAME,
            documentCount: parseInt(currentStore?.activeDocumentsCount || '0'),
            trackedDocumentCount: trackedCount,
            sizeBytes: parseInt(currentStore?.sizeBytes || '0'),
            targetCount: 607,
            percentComplete: Math.round((trackedCount / 607) * 100),
            isComplete: trackedCount >= 607,
            hasDuplicatesInTracker: hasDuplicates,
            duplicateCountInTracker: duplicateCount,
            uniqueFileCount: fileSet.size
        });
    } catch (error) {
        console.error('Error checking RAG store status:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// Verify uploaded files - check for duplicates and provide detailed report
app.get('/api/rag-store/verify/:ragStoreName', async (req, res) => {
    try {
        const { ragStoreName } = req.params;

        const trackedFiles = geminiService.getUploadedFilesList(ragStoreName);
        const fileSet = new Set<string>();
        const duplicates: string[] = [];

        // Check for duplicates
        for (const fileName of trackedFiles) {
            if (fileSet.has(fileName)) {
                duplicates.push(fileName);
            } else {
                fileSet.add(fileName);
            }
        }

        res.json({
            ragStoreName,
            totalTrackedEntries: trackedFiles.length,
            uniqueFiles: fileSet.size,
            duplicateCount: duplicates.length,
            duplicateFiles: duplicates,
            hasDuplicates: duplicates.length > 0,
            allFilenames: Array.from(fileSet).sort()
        });
    } catch (error) {
        console.error('Error verifying RAG store:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// Create RAG store and upload documents from directory
app.post('/api/rag-store/create', async (req, res) => {
    // Acquire lock to prevent concurrent RAG store creation
    await acquireRagStoreLock();

    try {
        const { forceReload, resumeMode } = req.body;

        console.log(`Getting or creating RAG store: ${RAG_STORE_NAME} (forceReload: ${forceReload}, resumeMode: ${resumeMode})`);

        // Set up SSE for progress updates
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Check if store exists and delete if force reload requested
        let ragStoreName: string;
        let isNew: boolean;

        if (forceReload) {
            // Delete existing store if it exists
            const existingStoreName = await geminiService.getRagStoreByDisplayName(RAG_STORE_NAME);
            if (existingStoreName) {
                console.log(`Force reload requested - deleting existing store: ${existingStoreName}`);
                res.write(`data: ${JSON.stringify({ type: 'progress', current: 0, total: 0, message: 'Deleting old documents...' })}\n\n`);
                await geminiService.deleteRagStore(existingStoreName);
                activeStores.delete(existingStoreName);
            }
            // Create new store
            const result = await geminiService.getOrCreateRagStore(RAG_STORE_NAME);
            ragStoreName = result.ragStoreName;
            isNew = result.isNew;
            console.log(`RAG store: ${ragStoreName} (recreated after force reload)`);
        } else {
            const result = await geminiService.getOrCreateRagStore(RAG_STORE_NAME);
            ragStoreName = result.ragStoreName;
            isNew = result.isNew;
            console.log(`RAG store: ${ragStoreName} (${isNew ? 'newly created' : 'existing'})`);
        }

        let fileNames: string[] = [];
        let skippedFiles: string[] = [];
        let failedFiles: Array<{ fileName: string; error: string }> = [];
        let questions: string[] = [];

        if (isNew || forceReload || resumeMode) {
            if (resumeMode) {
                res.write(`data: ${JSON.stringify({ type: 'progress', current: 0, total: 0, message: 'Checking for missing documents...' })}\n\n`);
            } else if (forceReload) {
                res.write(`data: ${JSON.stringify({ type: 'progress', current: 0, total: 0, message: 'Uploading fresh documents...' })}\n\n`);
            } else {
                res.write(`data: ${JSON.stringify({ type: 'progress', current: 0, total: 0, message: 'Creating document index...' })}\n\n`);
            }

            // Upload documents with progress (resume mode if requested)
            const uploadResult = await geminiService.uploadDirectoryToRagStore(
                ragStoreName,
                DOCUMENTS_DIR,
                (current, total, fileName) => {
                    const totalSteps = total + 2; // +2 for: create store + generate questions
                    const mode = resumeMode ? 'Uploading missing documents' : 'Generating embeddings';
                    res.write(`data: ${JSON.stringify({
                        type: 'progress',
                        current: current + 1,
                        total: totalSteps,
                        message: mode,
                        fileName: `(${current}/${total}) ${fileName} - Step ${current + 1}/${totalSteps}`
                    })}\n\n`);
                },
                resumeMode || false
            );

            skippedFiles = uploadResult.skipped || [];

            fileNames = uploadResult.successful;
            failedFiles = uploadResult.failed;

            console.log(`Uploaded ${fileNames.length} files to RAG store`);
            if (failedFiles.length > 0) {
                console.warn(`${failedFiles.length} files failed to upload`);
            }

            // Generate example questions
            res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Generating suggestions...', fileName: '' })}\n\n`);
            questions = await geminiService.generateExampleQuestions(ragStoreName);
        } else {
            // Using cached store
            res.write(`data: ${JSON.stringify({ type: 'progress', current: 1, total: 1, message: 'Loading existing documents...' })}\n\n`);
            console.log('Using existing RAG store, skipping upload');

            // Generate fresh example questions even for cached store
            res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Generating suggestions...', fileName: '' })}\n\n`);
            questions = await geminiService.generateExampleQuestions(ragStoreName);

            // We don't know the exact file names from cached store, so leave empty
            fileNames = [];
        }

        // Store the RAG store name
        activeStores.set(ragStoreName, RAG_STORE_NAME);

        // Get final document count
        const stores = await geminiService.listRagStores();
        const finalStore = stores.find(s => s.name === ragStoreName);
        const documentCount = parseInt(finalStore?.activeDocumentsCount || '0');

        // Send completion
        res.write(`data: ${JSON.stringify({
            type: 'complete',
            ragStoreName,
            fileNames,
            skippedFiles,
            failedFiles,
            exampleQuestions: questions,
            cached: !isNew && !forceReload && !resumeMode,
            resumeMode: resumeMode || false,
            documentCount,
            targetCount: 607
        })}\n\n`);

        res.end();
    } catch (error) {
        console.error('Error creating RAG store:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n\n`);
            res.end();
        }
    } finally {
        // Always release the lock when done
        releaseRagStoreLock();
    }
});

// Query the RAG store
app.post('/api/rag-store/query', async (req, res) => {
    try {
        const { ragStoreName, query } = req.body;

        if (!ragStoreName || !query) {
            return res.status(400).json({ error: 'ragStoreName and query are required' });
        }

        console.log(`Querying RAG store ${ragStoreName}: ${query}`);
        const result = await geminiService.fileSearch(ragStoreName, query);

        res.json(result);
    } catch (error) {
        console.error('Error querying RAG store:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// Delete RAG store
app.delete('/api/rag-store/:ragStoreName', async (req, res) => {
    try {
        const { ragStoreName } = req.params;

        console.log(`Deleting RAG store: ${ragStoreName}`);
        await geminiService.deleteRagStore(ragStoreName);
        activeStores.delete(ragStoreName);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting RAG store:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// ============ DEBUG ENDPOINTS ============

// List ALL RAG stores in the account
app.get('/api/debug/all-rag-stores', async (req, res) => {
    try {
        const stores = await geminiService.listRagStores();

        const storeDetails = stores.map(store => ({
            name: store.name,
            displayName: store.displayName,
            documentCount: parseInt(store.activeDocumentsCount || '0'),
            sizeBytes: parseInt(store.sizeBytes || '0'),
            createTime: store.createTime,
            updateTime: store.updateTime
        }));

        // Group by displayName
        const grouped: { [key: string]: any[] } = {};
        storeDetails.forEach(store => {
            const displayName = store.displayName || 'unnamed';
            if (!grouped[displayName]) {
                grouped[displayName] = [];
            }
            grouped[displayName].push(store);
        });

        // Find duplicates
        const duplicates = Object.entries(grouped).filter(([_, stores]) => stores.length > 1);

        res.json({
            totalStores: stores.length,
            stores: storeDetails,
            groupedByDisplayName: grouped,
            duplicateDisplayNames: duplicates.length > 0 ? Object.fromEntries(duplicates) : null,
            hasDuplicates: duplicates.length > 0,
            duplicateCount: duplicates.length
        });
    } catch (error) {
        console.error('Error listing all RAG stores:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// Show upload tracker contents
app.get('/api/debug/upload-tracker', async (req, res) => {
    try {
        const tracker = geminiService.getUploadTrackerContents();

        const analysis: { [ragStoreName: string]: any } = {};

        for (const [ragStoreName, data] of Object.entries(tracker)) {
            const files = data.uploadedFiles || [];
            const uniqueFiles = new Set(files);
            const duplicates: string[] = [];

            const seen = new Set<string>();
            files.forEach(file => {
                if (seen.has(file)) {
                    if (!duplicates.includes(file)) {
                        duplicates.push(file);
                    }
                } else {
                    seen.add(file);
                }
            });

            analysis[ragStoreName] = {
                totalEntries: files.length,
                uniqueFiles: uniqueFiles.size,
                hasDuplicates: duplicates.length > 0,
                duplicateCount: duplicates.length,
                duplicateFiles: duplicates,
                lastUpdate: data.lastUpdate
            };
        }

        res.json({
            tracker,
            analysis
        });
    } catch (error) {
        console.error('Error reading upload tracker:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// Clean up duplicate RAG stores (keeps only the most recent one per displayName)
app.post('/api/debug/cleanup-duplicate-stores', async (req, res) => {
    try {
        const result = await geminiService.cleanupDuplicateStores(RAG_STORE_NAME);
        res.json(result);
    } catch (error) {
        console.error('Error cleaning up duplicate stores:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// Fix upload tracker duplicates
app.post('/api/debug/fix-tracker-duplicates', async (req, res) => {
    try {
        const { ragStoreName } = req.body;
        if (!ragStoreName) {
            return res.status(400).json({ error: 'ragStoreName is required' });
        }

        const result = geminiService.deduplicateTrackerEntries(ragStoreName);
        res.json(result);
    } catch (error) {
        console.error('Error fixing tracker duplicates:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
