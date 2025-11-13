/**
 * Retry script with VERY long delays to avoid rate limiting
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
    '341 St Kitts and Nevis National Security Strategy 2021.txt', // Try smallest first
    '39 Belgium The Strategic Vision for Defence 2030 (2016).txt',
    '183 Japan Defense of Japan 2021.txt',
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

async function uploadWithPatience(ragStoreName, filePath, fileName) {
    const maxRetries = 3;
    const maxPollAttempts = 200; // 10 minutes max polling

    const fileSize = fs.statSync(filePath).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(2);

    console.log(`\nAttempting: ${fileName} (${sizeMB} MB)`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log(`  Attempt ${attempt + 1}/${maxRetries}...`);

            const fileBuffer = fs.readFileSync(filePath);
            const file = new File([fileBuffer], fileName, {
                type: getContentType(filePath)
            });

            console.log(`  Sending upload request...`);
            let op = await ai.fileSearchStores.uploadToFileSearchStore({
                fileSearchStoreName: ragStoreName,
                file: file
            });

            console.log(`  ✓ Upload request accepted! Processing...`);
            let pollAttempts = 0;

            while (!op.done) {
                if (pollAttempts >= maxPollAttempts) {
                    throw new Error(`Timeout after ${maxPollAttempts * 3}s`);
                }

                await delay(3000);
                op = await ai.operations.get({ operation: op });
                pollAttempts++;

                if (pollAttempts % 20 === 0) {
                    console.log(`  Processing... (${pollAttempts * 3}s elapsed)`);
                }
            }

            console.log(`  ✓✓✓ SUCCESS! File uploaded!`);
            return { success: true, fileName, attempts: attempt + 1 };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.log(`  ✗ Failed: ${errorMsg}`);

            const isLastAttempt = attempt === maxRetries - 1;
            if (isLastAttempt) {
                return { success: false, fileName, error: errorMsg, attempts: maxRetries };
            }

            // Very long delay before retry
            const retryDelay = 30000; // 30 seconds
            console.log(`  Waiting ${retryDelay / 1000}s before retry...`);
            await delay(retryDelay);
        }
    }
}

async function retryWithPatience() {
    console.log('='.repeat(80));
    console.log('RETRY WITH EXTENDED DELAYS');
    console.log('='.repeat(80));
    console.log('Strategy: Try smallest files first with 2-minute gaps\n');

    // Get RAG store
    console.log('Finding RAG store...');
    const response = await ai.fileSearchStores.list();
    const stores = response.pageInternal || response.fileSearchStores || [];
    const ragStore = stores.find(s => s.displayName === 'national-security-documents-store');

    if (!ragStore) {
        console.error('❌ RAG store not found');
        process.exit(1);
    }

    console.log(`✓ Found: ${ragStore.name}`);
    console.log(`  Current docs: ${ragStore.activeDocumentsCount || 0}\n`);
    console.log('='.repeat(80));

    const results = [];

    for (let i = 0; i < failedFiles.length; i++) {
        const fileName = failedFiles[i];
        const filePath = path.join(DOCUMENTS_DIR, fileName);

        console.log(`\n[${i + 1}/${failedFiles.length}] ${fileName}`);

        if (!fs.existsSync(filePath)) {
            console.log(`  ✗ File not found`);
            results.push({ success: false, fileName, error: 'File not found' });
            continue;
        }

        const result = await uploadWithPatience(ragStore.name, filePath, fileName);
        results.push(result);

        // VERY long delay between files (2 minutes)
        if (i < failedFiles.length - 1) {
            const waitTime = 120; // 2 minutes
            console.log(`\n  === Waiting ${waitTime}s before next file to avoid rate limits ===`);
            for (let countdown = waitTime; countdown > 0; countdown -= 10) {
                console.log(`  ${countdown}s remaining...`);
                await delay(10000);
            }
        }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('FINAL RESULTS');
    console.log('='.repeat(80));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nSuccess: ${successful.length}/${failedFiles.length}`);
    successful.forEach(r => {
        console.log(`  ✓ ${r.fileName}`);
    });

    if (failed.length > 0) {
        console.log(`\nFailed: ${failed.length}/${failedFiles.length}`);
        failed.forEach(r => {
            console.log(`  ✗ ${r.fileName}: ${r.error}`);
        });
    }

    // Final count
    const finalResponse = await ai.fileSearchStores.list();
    const finalStores = finalResponse.pageInternal || finalResponse.fileSearchStores || [];
    const finalStore = finalStores.find(s => s.name === ragStore.name);

    if (finalStore) {
        const finalCount = parseInt(finalStore.activeDocumentsCount || '0');
        console.log(`\nFinal count: ${finalCount}/607`);

        if (finalCount === 607) {
            console.log('\n🎉 ALL 607 DOCUMENTS UPLOADED!');
        } else {
            console.log(`\nMissing: ${607 - finalCount} documents`);
        }
    }

    console.log('\n' + '='.repeat(80));
}

retryWithPatience().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
