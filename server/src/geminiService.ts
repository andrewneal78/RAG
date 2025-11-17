/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import fs from 'fs';
import path from 'path';
import { getMetadataForFile, DocumentMetadata } from './metadataLoader.js';

interface GroundingChunk {
    retrievedContext?: {
        text?: string;
        uri?: string;
        title?: string;
    };
    metadata?: DocumentMetadata;
    fileName?: string;
}

interface QueryResult {
    text: string;
    groundingChunks: GroundingChunk[];
}

let ai: GoogleGenAI;

export function initialize(apiKey: string) {
    ai = new GoogleGenAI({ apiKey });
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listRagStores(): Promise<any[]> {
    if (!ai) throw new Error("Gemini AI not initialized");
    try {
        const response: any = await ai.fileSearchStores.list();
        // The SDK returns stores in pageInternal, not fileSearchStores
        const stores = response.pageInternal || response.fileSearchStores || [];
        console.log(`Found ${stores.length} RAG stores in account`);
        return stores;
    } catch (error) {
        console.error("Error listing RAG stores:", error);
        return [];
    }
}

export async function getRagStoreByDisplayName(displayName: string): Promise<string | null> {
    const stores = await listRagStores();
    console.log(`Searching for store with displayName: "${displayName}"`);

    // Find all stores with matching displayName
    const matchingStores = stores.filter(s => s.displayName === displayName);

    if (matchingStores.length === 0) {
        console.log(`No match found for displayName: "${displayName}"`);
        return null;
    }

    // If multiple exist, use the one with most documents (most recent upload)
    const store = matchingStores.reduce((best, current) => {
        const bestCount = parseInt(best.activeDocumentsCount || '0');
        const currentCount = parseInt(current.activeDocumentsCount || '0');
        return currentCount > bestCount ? current : best;
    });

    console.log(`Found ${matchingStores.length} matching store(s), using: ${store.name} (${store.activeDocumentsCount || 0} documents)`);
    return store.name;
}

export async function createRagStore(displayName: string): Promise<string> {
    if (!ai) throw new Error("Gemini AI not initialized");
    const ragStore = await ai.fileSearchStores.create({ config: { displayName } });
    if (!ragStore.name) {
        throw new Error("Failed to create RAG store: name is missing.");
    }
    return ragStore.name;
}

export async function getOrCreateRagStore(displayName: string): Promise<{ ragStoreName: string, isNew: boolean }> {
    if (!ai) throw new Error("Gemini AI not initialized");

    // Check if store already exists
    const stores = await listRagStores();
    const matchingStores = stores.filter(s => s.displayName === displayName);

    if (matchingStores.length === 0) {
        // No store exists - create new one
        console.log(`Creating new RAG store: ${displayName}`);
        const ragStoreName = await createRagStore(displayName);
        return { ragStoreName, isNew: true };
    }

    if (matchingStores.length === 1) {
        // Exactly one store exists - use it
        console.log(`Found existing RAG store: ${matchingStores[0].name}`);
        return { ragStoreName: matchingStores[0].name, isNew: false };
    }

    // Multiple stores exist with same displayName - CLEAN UP DUPLICATES
    console.warn(`⚠️  Found ${matchingStores.length} RAG stores with displayName "${displayName}" - cleaning up duplicates!`);

    // Keep the one with most documents (most recent upload)
    const storeToKeep = matchingStores.reduce((best, current) => {
        const bestCount = parseInt(best.activeDocumentsCount || '0');
        const currentCount = parseInt(current.activeDocumentsCount || '0');
        return currentCount > bestCount ? current : best;
    });

    console.log(`Keeping: ${storeToKeep.name} (${storeToKeep.activeDocumentsCount || 0} documents)`);

    // Delete all other stores
    const storesToDelete = matchingStores.filter(s => s.name !== storeToKeep.name);
    console.log(`Deleting ${storesToDelete.length} duplicate store(s)...`);

    for (const store of storesToDelete) {
        try {
            console.log(`  Deleting duplicate: ${store.name} (${store.activeDocumentsCount || 0} documents)`);
            await deleteRagStore(store.name);
        } catch (error) {
            console.error(`  Failed to delete duplicate ${store.name}:`, error);
        }
    }

    console.log(`✅ Cleanup complete. Using: ${storeToKeep.name}`);
    return { ragStoreName: storeToKeep.name, isNew: false };
}

// Track uploaded files locally since the SDK doesn't support listing documents
const UPLOAD_TRACKER_FILE = path.join(process.cwd(), '.upload-tracker.json');

interface UploadTracker {
    [ragStoreName: string]: {
        uploadedFiles: string[];
        lastUpdate: string;
    };
}

function loadUploadTracker(): UploadTracker {
    try {
        if (fs.existsSync(UPLOAD_TRACKER_FILE)) {
            const data = fs.readFileSync(UPLOAD_TRACKER_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.warn('Failed to load upload tracker:', error);
    }
    return {};
}

function saveUploadTracker(tracker: UploadTracker): void {
    try {
        fs.writeFileSync(UPLOAD_TRACKER_FILE, JSON.stringify(tracker, null, 2));
    } catch (error) {
        console.error('Failed to save upload tracker:', error);
    }
}

function addUploadedFile(ragStoreName: string, fileName: string): void {
    const tracker = loadUploadTracker();
    if (!tracker[ragStoreName]) {
        tracker[ragStoreName] = { uploadedFiles: [], lastUpdate: new Date().toISOString() };
    }

    // CRITICAL: Check for duplicates before adding
    if (!tracker[ragStoreName].uploadedFiles.includes(fileName)) {
        tracker[ragStoreName].uploadedFiles.push(fileName);
        tracker[ragStoreName].lastUpdate = new Date().toISOString();
        saveUploadTracker(tracker);
    } else {
        console.warn(`⚠️  Attempted to add duplicate file to tracker: ${fileName} (already exists in ${ragStoreName})`);
    }
}

function clearUploadTracker(ragStoreName: string): void {
    const tracker = loadUploadTracker();
    delete tracker[ragStoreName];
    saveUploadTracker(tracker);
}

export async function listDocumentsInRagStore(ragStoreName: string): Promise<Set<string>> {
    // Use local tracker since SDK doesn't support listing documents
    const tracker = loadUploadTracker();
    const uploadedFiles = tracker[ragStoreName]?.uploadedFiles || [];

    // Proactively check for duplicates and fix if found
    const uniqueFiles = new Set(uploadedFiles);
    if (uniqueFiles.size !== uploadedFiles.length) {
        const duplicateCount = uploadedFiles.length - uniqueFiles.size;
        console.warn(`⚠️  Found ${duplicateCount} duplicate(s) in tracker for ${ragStoreName} - auto-fixing...`);
        tracker[ragStoreName].uploadedFiles = Array.from(uniqueFiles);
        tracker[ragStoreName].lastUpdate = new Date().toISOString();
        saveUploadTracker(tracker);
        console.log(`✅ Tracker cleaned: ${uploadedFiles.length} → ${uniqueFiles.size} entries`);
    }

    console.log(`Found ${uniqueFiles.size} unique documents in local tracker for ${ragStoreName}`);
    return uniqueFiles;
}

export function getUploadedFilesCount(ragStoreName: string): number {
    const tracker = loadUploadTracker();
    return tracker[ragStoreName]?.uploadedFiles?.length || 0;
}

export function getUploadedFilesList(ragStoreName: string): string[] {
    const tracker = loadUploadTracker();
    return tracker[ragStoreName]?.uploadedFiles || [];
}

export async function uploadFileToRagStore(ragStoreName: string, filePath: string, onProgress?: (fileName: string) => void): Promise<void> {
    if (!ai) throw new Error("Gemini AI not initialized");

    const fileName = path.basename(filePath);
    const maxRetries = 5; // Increased from 3 to handle difficult files
    const baseDelay = 2000; // Increased from 1s to 2s for better retry spacing

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            if (onProgress) onProgress(fileName);

            const fileBuffer = fs.readFileSync(filePath);
            const file = new File([fileBuffer], fileName, {
                type: getContentType(filePath)
            });

            let op = await ai.fileSearchStores.uploadToFileSearchStore({
                fileSearchStoreName: ragStoreName,
                file: file
            });

            // Poll for completion with extended timeout
            const maxPollAttempts = 120; // Increased from 60 to 120 (6 minutes max)
            let pollAttempts = 0;

            while (!op.done) {
                if (pollAttempts >= maxPollAttempts) {
                    throw new Error(`Upload timeout for ${fileName} after ${maxPollAttempts * 3} seconds`);
                }
                await delay(3000);
                op = await ai.operations.get({operation: op});
                pollAttempts++;

                // Progress indicator for long uploads (every minute)
                if (pollAttempts % 20 === 0) {
                    console.log(`  Still processing ${fileName}... (${pollAttempts * 3}s elapsed)`);
                }
            }

            // Rate limiting: increased delay after successful upload
            await delay(1500); // Increased from 500ms to 1500ms
            return; // Success - exit retry loop

        } catch (error) {
            const isLastAttempt = attempt === maxRetries - 1;
            if (isLastAttempt) {
                // Final attempt failed - throw error
                throw new Error(`Failed to upload ${fileName} after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Exponential backoff before retry
            const retryDelay = baseDelay * Math.pow(2, attempt);
            console.warn(`Upload attempt ${attempt + 1} failed for ${fileName}, retrying in ${retryDelay}ms...`);
            await delay(retryDelay);
        }
    }
}

export interface UploadResult {
    successful: string[];
    failed: Array<{ fileName: string; error: string }>;
    skipped: string[];
}

export async function uploadDirectoryToRagStore(
    ragStoreName: string,
    directoryPath: string,
    onProgress?: (current: number, total: number, fileName: string) => void,
    resumeMode: boolean = false
): Promise<UploadResult> {
    if (!ai) throw new Error("Gemini AI not initialized");

    // Read all files from directory
    const allFilesArray = fs.readdirSync(directoryPath)
        .filter(file => {
            const ext = path.extname(file).toLowerCase();
            // Support common document formats
            return ['.txt', '.pdf', '.doc', '.docx', '.md', '.html', '.json'].includes(ext);
        });

    if (allFilesArray.length === 0) {
        throw new Error(`No supported documents found in ${directoryPath}`);
    }

    // CRITICAL: Deduplicate filenames within the directory
    // Use Map to track first occurrence of each filename
    const uniqueFilesMap = new Map<string, string>();
    const duplicatesInDirectory: string[] = [];

    for (const fileName of allFilesArray) {
        if (uniqueFilesMap.has(fileName)) {
            duplicatesInDirectory.push(fileName);
            console.warn(`⚠️  Duplicate filename found in directory: ${fileName} - will be uploaded only once`);
        } else {
            uniqueFilesMap.set(fileName, fileName);
        }
    }

    // Use only unique filenames for upload
    const allFiles = Array.from(uniqueFilesMap.keys());

    console.log(`Found ${allFilesArray.length} total files, ${allFiles.length} unique filenames`);
    if (duplicatesInDirectory.length > 0) {
        console.warn(`Detected ${duplicatesInDirectory.length} duplicate filename(s) in directory - these will be skipped to prevent duplicate uploads`);
    }

    let filesToUpload = allFiles;
    const skipped: string[] = [...duplicatesInDirectory]; // Start with in-directory duplicates

    // In resume mode, skip files that are already uploaded
    if (resumeMode) {
        console.log('Resume mode: checking for already uploaded documents...');
        const uploadedFiles = await listDocumentsInRagStore(ragStoreName);

        const alreadyUploaded: string[] = [];
        filesToUpload = allFiles.filter(fileName => {
            if (uploadedFiles.has(fileName)) {
                alreadyUploaded.push(fileName);
                skipped.push(fileName);
                return false;
            }
            return true;
        });

        console.log(`Resume mode: ${alreadyUploaded.length} files already uploaded (skipped), ${filesToUpload.length} remaining to upload`);
    }

    const successful: string[] = [];
    const failed: Array<{ fileName: string; error: string }> = [];
    const uploadedInSession = new Set<string>(); // Track what we upload in THIS session to prevent in-session duplicates

    console.log(`\n📤 Starting upload: ${filesToUpload.length} files to process`);
    console.log(`   Skipped (duplicates/already uploaded): ${skipped.length}`);
    console.log(`   Total unique files in directory: ${allFiles.length}`);

    // Upload each file, continuing even if individual files fail
    for (let i = 0; i < filesToUpload.length; i++) {
        const fileName = filesToUpload[i];

        // Safety check: ensure we don't upload the same file twice in this session
        if (uploadedInSession.has(fileName)) {
            console.warn(`⚠️  DUPLICATE DETECTED: ${fileName} already uploaded in this session - skipping`);
            skipped.push(fileName);
            continue;
        }

        const filePath = path.join(directoryPath, fileName);

        try {
            if (onProgress) {
                onProgress(i + 1, filesToUpload.length, fileName);
            }
            await uploadFileToRagStore(ragStoreName, filePath);
            addUploadedFile(ragStoreName, fileName); // Track successful upload
            uploadedInSession.add(fileName); // Mark as uploaded in this session
            successful.push(fileName);
            console.log(`✓ [${i + 1}/${filesToUpload.length}] Successfully uploaded: ${fileName}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            failed.push({ fileName, error: errorMessage });
            console.error(`✗ [${i + 1}/${filesToUpload.length}] Failed to upload ${fileName}: ${errorMessage}`);
            // Continue with next file instead of aborting
        }
    }

    console.log(`\n✅ Upload Summary:`);
    console.log(`   ✓ Successful: ${successful.length}`);
    console.log(`   ✗ Failed: ${failed.length}`);
    console.log(`   ⊘ Skipped: ${skipped.length}`);
    console.log(`   📁 Total files in directory: ${allFilesArray.length}`);
    console.log(`   🎯 Unique filenames: ${allFiles.length}`);

    if (failed.length > 0) {
        console.warn('\n❌ Failed files:');
        failed.forEach(f => console.warn(`  - ${f.fileName}: ${f.error}`));
    }

    if (skipped.length > 0) {
        console.log(`\n⊘ Skipped files (${skipped.length} total):`);
        if (duplicatesInDirectory.length > 0) {
            console.log(`  - ${duplicatesInDirectory.length} duplicate filename(s) in directory`);
        }
        const alreadyUploadedCount = skipped.length - duplicatesInDirectory.length;
        if (alreadyUploadedCount > 0) {
            console.log(`  - ${alreadyUploadedCount} already uploaded (resume mode)`);
        }
    }

    return { successful, failed, skipped };
}

export async function fileSearch(ragStoreName: string, query: string): Promise<QueryResult> {
    if (!ai) throw new Error("Gemini AI not initialized");
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: query + " DO NOT ASK THE USER TO READ THE MANUAL, pinpoint the relevant sections in the response itself.",
        config: {
            tools: [
                {
                    fileSearch: {
                        fileSearchStoreNames: [ragStoreName],
                    }
                }
            ]
        }
    });

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    // Enrich grounding chunks with metadata
    const enrichedChunks = groundingChunks.map((chunk: any) => {
        const enrichedChunk: GroundingChunk = { ...chunk };

        // Try to extract filename from the chunk
        // The chunk may have a uri or title field containing the filename
        let fileName: string | null = null;

        if (chunk.retrievedContext?.uri) {
            // Extract filename from URI if present
            fileName = path.basename(chunk.retrievedContext.uri);
        } else if (chunk.retrievedContext?.title) {
            // Use title as filename if no URI
            fileName = chunk.retrievedContext.title;
        }

        // Store the filename in the chunk
        if (fileName) {
            enrichedChunk.fileName = fileName;

            // Look up metadata if we have a filename
            const metadata = getMetadataForFile(fileName);
            if (metadata) {
                enrichedChunk.metadata = metadata;
            }
        }

        return enrichedChunk;
    });

    return {
        text: response.text || '',
        groundingChunks: enrichedChunks,
    };
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    if (!ai) throw new Error("Gemini AI not initialized");
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: "You are provided national security and defense strategy documents from various countries. Analyze the cover pages to identify which country and what type of document each one is (e.g., Defense White Paper, National Security Strategy, etc.). DO NOT GUESS OR HALLUCINATE. Then, for each unique document type or country, generate 4 short and practical example questions a researcher might ask about defense and security policy. Return the questions as a JSON array of objects. Each object should have a 'document' key (e.g., 'Japan Defense Strategy 2022') and a 'questions' key with an array of 4 question strings. For example: ```json[{\"document\": \"Australia Defense White Paper 2016\", \"questions\": [\"What are the primary strategic challenges identified?\", \"How does the document address cyber security threats?\"]}, {\"document\": \"Germany National Security Strategy 2023\", \"questions\": [...]}]```",
            config: {
                tools: [
                    {
                        fileSearch: {
                            fileSearchStoreNames: [ragStoreName],
                        }
                    }
                ]
            }
        });

        let jsonText = (response.text || '').trim();

        const jsonMatch = jsonText.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            jsonText = jsonMatch[1];
        } else {
            const firstBracket = jsonText.indexOf('[');
            const lastBracket = jsonText.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
                jsonText = jsonText.substring(firstBracket, lastBracket + 1);
            }
        }

        const parsedData = JSON.parse(jsonText);

        if (Array.isArray(parsedData)) {
            if (parsedData.length === 0) {
                return [];
            }
            const firstItem = parsedData[0];

            // Handle new format: array of {document, questions[]} or {product, questions[]}
            if (typeof firstItem === 'object' && firstItem !== null && 'questions' in firstItem && Array.isArray(firstItem.questions)) {
                return parsedData.flatMap(item => (item.questions || [])).filter(q => typeof q === 'string');
            }

            // Handle old format: array of strings
            if (typeof firstItem === 'string') {
                return parsedData.filter(q => typeof q === 'string');
            }
        }

        console.warn("Received unexpected format for example questions:", parsedData);
        return [];
    } catch (error) {
        console.error("Failed to generate or parse example questions:", error);
        return [];
    }
}

export async function deleteRagStore(ragStoreName: string): Promise<void> {
    if (!ai) throw new Error("Gemini AI not initialized");
    await ai.fileSearchStores.delete({
        name: ragStoreName,
        config: { force: true },
    });
    // Clear the upload tracker for this store
    clearUploadTracker(ragStoreName);
}

// ============ DEBUG AND MAINTENANCE FUNCTIONS ============

export function getUploadTrackerContents(): UploadTracker {
    return loadUploadTracker();
}

export function deduplicateTrackerEntries(ragStoreName: string): { before: number; after: number; duplicatesRemoved: number } {
    const tracker = loadUploadTracker();

    if (!tracker[ragStoreName]) {
        return { before: 0, after: 0, duplicatesRemoved: 0 };
    }

    const beforeCount = tracker[ragStoreName].uploadedFiles.length;
    const uniqueFiles = Array.from(new Set(tracker[ragStoreName].uploadedFiles));
    const afterCount = uniqueFiles.length;

    tracker[ragStoreName].uploadedFiles = uniqueFiles;
    tracker[ragStoreName].lastUpdate = new Date().toISOString();
    saveUploadTracker(tracker);

    console.log(`Deduplicated tracker for ${ragStoreName}: ${beforeCount} → ${afterCount} (removed ${beforeCount - afterCount} duplicates)`);

    return {
        before: beforeCount,
        after: afterCount,
        duplicatesRemoved: beforeCount - afterCount
    };
}

export async function cleanupDuplicateStores(displayName: string): Promise<{
    found: number;
    deleted: number;
    kept: string | null;
    deletedStores: string[];
}> {
    if (!ai) throw new Error("Gemini AI not initialized");

    const stores = await listRagStores();
    const matchingStores = stores.filter(s => s.displayName === displayName);

    if (matchingStores.length <= 1) {
        console.log(`No duplicate stores found for displayName: "${displayName}"`);
        return {
            found: matchingStores.length,
            deleted: 0,
            kept: matchingStores[0]?.name || null,
            deletedStores: []
        };
    }

    console.log(`Found ${matchingStores.length} stores with displayName "${displayName}" - cleaning up duplicates...`);

    // Keep the one with most documents (most recent upload)
    const storeToKeep = matchingStores.reduce((best, current) => {
        const bestCount = parseInt(best.activeDocumentsCount || '0');
        const currentCount = parseInt(current.activeDocumentsCount || '0');
        return currentCount > bestCount ? current : best;
    });

    const storesToDelete = matchingStores.filter(s => s.name !== storeToKeep.name);

    console.log(`Keeping: ${storeToKeep.name} (${storeToKeep.activeDocumentsCount || 0} documents)`);
    console.log(`Deleting ${storesToDelete.length} duplicate store(s)...`);

    const deletedStores: string[] = [];

    for (const store of storesToDelete) {
        try {
            console.log(`  Deleting: ${store.name} (${store.activeDocumentsCount || 0} documents)`);
            await deleteRagStore(store.name);
            deletedStores.push(store.name);
        } catch (error) {
            console.error(`  Failed to delete ${store.name}:`, error);
        }
    }

    console.log(`Cleanup complete. Kept: ${storeToKeep.name}, Deleted: ${deletedStores.length}`);

    return {
        found: matchingStores.length,
        deleted: deletedStores.length,
        kept: storeToKeep.name,
        deletedStores
    };
}

function getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: { [key: string]: string } = {
        '.txt': 'text/plain',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.md': 'text/markdown',
        '.html': 'text/html',
        '.json': 'application/json'
    };
    return contentTypes[ext] || 'application/octet-stream';
}
