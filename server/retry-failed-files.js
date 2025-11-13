/**
 * Retry script for failed file uploads with extended settings
 */
import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR || '/Users/aneal/Library/CloudStorage/OneDrive-UniversityofEdinburgh/national_security_analysis/gemini_PDF_processor/output/clean_final';
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
    console.error('No API key found');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const failedFiles = [
    '183 Japan Defense of Japan 2021.txt',
    '341 St Kitts and Nevis National Security Strategy 2021.txt',
    '39 Belgium The Strategic Vision for Defence 2030 (2016).txt',
    '578 Japan Defence of Japan 2016.txt'
];

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
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

async function uploadLargeFile(ragStoreName, filePath, fileName) {
    const maxRetries = 5; // More attempts for large files
    const baseDelay = 2000; // 2 second base delay
    const maxPollAttempts = 120; // 6 minutes max polling (120 * 3s)

    const fileSize = fs.statSync(filePath).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(2);

    console.log(`\nAttempting to upload: ${fileName} (${sizeMB} MB)`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log(`  Attempt ${attempt + 1}/${maxRetries}...`);

            const fileBuffer = fs.readFileSync(filePath);
            const file = new File([fileBuffer], fileName, {
                type: getContentType(filePath)
            });

            console.log(`  Initiating upload...`);
            let op = await ai.fileSearchStores.uploadToFileSearchStore({
                fileSearchStoreName: ragStoreName,
                file: file
            });

            console.log(`  Upload initiated, waiting for completion...`);
            let pollAttempts = 0;

            while (!op.done) {
                if (pollAttempts >= maxPollAttempts) {
                    throw new Error(`Upload timeout after ${maxPollAttempts * 3} seconds`);
                }

                await delay(3000);
                op = await ai.operations.get({ operation: op });
                pollAttempts++;

                // Progress indicator for large files
                if (pollAttempts % 10 === 0) {
                    console.log(`  Still processing... (${pollAttempts * 3}s elapsed)`);
                }
            }

            console.log(`  ✓ Upload completed successfully!`);

            // Rate limiting: longer delay after large file
            await delay(2000);
            return { success: true, fileName, attempts: attempt + 1 };

        } catch (error) {
            const isLastAttempt = attempt === maxRetries - 1;
            const errorMsg = error instanceof Error ? error.message : String(error);

            if (isLastAttempt) {
                console.log(`  ✗ Failed after ${maxRetries} attempts`);
                console.log(`  Error: ${errorMsg}`);
                return { success: false, fileName, error: errorMsg, attempts: maxRetries };
            }

            // Exponential backoff with longer delays for large files
            const retryDelay = baseDelay * Math.pow(2, attempt);
            console.log(`  ⚠️  Attempt failed: ${errorMsg}`);
            console.log(`  Retrying in ${retryDelay / 1000}s...`);
            await delay(retryDelay);
        }
    }
}

async function retryFailedFiles() {
    console.log('='.repeat(80));
    console.log('RETRY FAILED FILES - Extended Settings');
    console.log('='.repeat(80));
    console.log(`Documents directory: ${DOCUMENTS_DIR}`);
    console.log(`Files to retry: ${failedFiles.length}\n`);

    // Get RAG store
    console.log('Finding RAG store...');
    const response = await ai.fileSearchStores.list();
    const stores = response.pageInternal || response.fileSearchStores || [];
    const ragStore = stores.find(s => s.displayName === 'national-security-documents-store');

    if (!ragStore) {
        console.error('❌ RAG store not found. Please ensure the main upload has been run first.');
        process.exit(1);
    }

    console.log(`✓ Found RAG store: ${ragStore.name}`);
    console.log(`  Current documents: ${ragStore.activeDocumentsCount || 0}\n`);
    console.log('='.repeat(80));

    const results = [];

    for (let i = 0; i < failedFiles.length; i++) {
        const fileName = failedFiles[i];
        const filePath = path.join(DOCUMENTS_DIR, fileName);

        console.log(`\n[${i + 1}/${failedFiles.length}] Processing: ${fileName}`);

        if (!fs.existsSync(filePath)) {
            console.log(`  ✗ File not found at: ${filePath}`);
            results.push({ success: false, fileName, error: 'File not found' });
            continue;
        }

        const result = await uploadLargeFile(ragStore.name, filePath, fileName);
        results.push(result);

        // Longer delay between files
        if (i < failedFiles.length - 1) {
            console.log(`\n  Waiting 3s before next file...`);
            await delay(3000);
        }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('RETRY SUMMARY');
    console.log('='.repeat(80));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nSuccessfully uploaded: ${successful.length}/${failedFiles.length}`);
    if (successful.length > 0) {
        successful.forEach(r => {
            console.log(`  ✓ ${r.fileName} (attempt ${r.attempts})`);
        });
    }

    if (failed.length > 0) {
        console.log(`\nStill failed: ${failed.length}/${failedFiles.length}`);
        failed.forEach(r => {
            console.log(`  ✗ ${r.fileName}: ${r.error}`);
        });
    }

    // Check final count
    console.log('\nChecking final document count...');
    const finalResponse = await ai.fileSearchStores.list();
    const finalStores = finalResponse.pageInternal || finalResponse.fileSearchStores || [];
    const finalStore = finalStores.find(s => s.name === ragStore.name);

    if (finalStore) {
        const finalCount = parseInt(finalStore.activeDocumentsCount || '0');
        console.log(`Final document count: ${finalCount}/607`);

        if (finalCount === 607) {
            console.log('\n🎉 SUCCESS! All 607 documents are now uploaded!');
        } else {
            console.log(`\n⚠️  Still missing ${607 - finalCount} documents`);
        }
    }

    console.log('\n' + '='.repeat(80));
}

retryFailedFiles().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
