/**
 * Debug utility to inspect and manage RAG stores
 *
 * Usage:
 *   node debug-rag-stores.js list           - List all RAG stores
 *   node debug-rag-stores.js tracker        - Show upload tracker contents
 *   node debug-rag-stores.js cleanup        - Clean up duplicate stores
 *   node debug-rag-stores.js fix-tracker    - Fix tracker duplicates
 */

const http = require('http');

const API_BASE = 'http://localhost:3001';

function makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_BASE + path);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

async function listAllStores() {
    console.log('🔍 Fetching all RAG stores...\n');
    const result = await makeRequest('/api/debug/all-rag-stores');

    console.log(`Total RAG stores in account: ${result.totalStores}\n`);

    if (result.hasDuplicates) {
        console.log('⚠️  WARNING: Duplicate displayNames detected!\n');
        for (const [displayName, stores] of Object.entries(result.duplicateDisplayNames)) {
            console.log(`  "${displayName}" has ${stores.length} stores:`);
            stores.forEach(store => {
                console.log(`    - ${store.name}`);
                console.log(`      Documents: ${store.documentCount}`);
                console.log(`      Size: ${(store.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
                console.log(`      Created: ${store.createTime}`);
                console.log();
            });
        }
    }

    console.log('All stores:');
    result.stores.forEach(store => {
        console.log(`\n📦 ${store.displayName || 'unnamed'}`);
        console.log(`   ID: ${store.name}`);
        console.log(`   Documents: ${store.documentCount}`);
        console.log(`   Size: ${(store.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
    });
}

async function showTracker() {
    console.log('🔍 Fetching upload tracker...\n');
    const result = await makeRequest('/api/debug/upload-tracker');

    console.log('Upload Tracker Analysis:\n');
    for (const [ragStoreName, analysis] of Object.entries(result.analysis)) {
        console.log(`📋 ${ragStoreName}`);
        console.log(`   Total entries: ${analysis.totalEntries}`);
        console.log(`   Unique files: ${analysis.uniqueFiles}`);
        console.log(`   Has duplicates: ${analysis.hasDuplicates ? '⚠️  YES' : '✓ NO'}`);
        if (analysis.hasDuplicates) {
            console.log(`   Duplicate count: ${analysis.duplicateCount}`);
            console.log(`   Duplicate files: ${analysis.duplicateFiles.join(', ')}`);
        }
        console.log(`   Last updated: ${analysis.lastUpdate}\n`);
    }
}

async function cleanupDuplicates() {
    console.log('🧹 Cleaning up duplicate RAG stores...\n');
    const result = await makeRequest('/api/debug/cleanup-duplicate-stores', 'POST');

    console.log(`Found: ${result.found} stores`);
    console.log(`Deleted: ${result.deleted} duplicate(s)`);
    console.log(`Kept: ${result.kept}\n`);

    if (result.deleted > 0) {
        console.log('✅ Cleanup complete!');
        console.log(`Deleted stores: ${result.deletedStores.join(', ')}`);
    } else {
        console.log('✓ No duplicates found');
    }
}

async function fixTracker() {
    // First, get the current tracker to find store names
    const trackerResult = await makeRequest('/api/debug/upload-tracker');
    const storeNames = Object.keys(trackerResult.tracker);

    if (storeNames.length === 0) {
        console.log('✓ No stores in tracker');
        return;
    }

    console.log(`🔧 Fixing tracker duplicates for ${storeNames.length} store(s)...\n`);

    for (const storeName of storeNames) {
        console.log(`Fixing: ${storeName}`);
        const result = await makeRequest('/api/debug/fix-tracker-duplicates', 'POST', { ragStoreName: storeName });
        console.log(`  Before: ${result.before} entries`);
        console.log(`  After: ${result.after} entries`);
        console.log(`  Removed: ${result.duplicatesRemoved} duplicate(s)\n`);
    }

    console.log('✅ Tracker cleanup complete!');
}

async function main() {
    const command = process.argv[2] || 'list';

    try {
        console.log('\n=== RAG Store Debug Utility ===\n');

        switch (command) {
            case 'list':
                await listAllStores();
                break;
            case 'tracker':
                await showTracker();
                break;
            case 'cleanup':
                await cleanupDuplicates();
                break;
            case 'fix-tracker':
                await fixTracker();
                break;
            default:
                console.log('Unknown command:', command);
                console.log('\nUsage:');
                console.log('  node debug-rag-stores.js list           - List all RAG stores');
                console.log('  node debug-rag-stores.js tracker        - Show upload tracker');
                console.log('  node debug-rag-stores.js cleanup        - Clean up duplicate stores');
                console.log('  node debug-rag-stores.js fix-tracker    - Fix tracker duplicates');
        }

        console.log('\n');
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error('\nMake sure the server is running on http://localhost:3001\n');
        process.exit(1);
    }
}

main();
