/**
 * Script to delete all RAG stores
 */
import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
    console.error('No API key found');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function deleteAllStores() {
    try {
        console.log('Listing all RAG stores...');
        const response = await ai.fileSearchStores.list();
        const stores = response.pageInternal || response.fileSearchStores || [];

        console.log(`Found ${stores.length} RAG stores`);

        if (stores.length === 0) {
            console.log('No stores to delete');
            return;
        }

        for (const store of stores) {
            console.log(`Deleting: ${store.name} (${store.displayName}) - ${store.activeDocumentsCount || 0} docs`);
            try {
                await ai.fileSearchStores.delete({
                    name: store.name,
                    config: { force: true }
                });
                console.log(`✓ Deleted ${store.name}`);
            } catch (err) {
                console.error(`✗ Failed to delete ${store.name}:`, err.message);
            }
        }

        console.log('\nAll stores deleted!');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

deleteAllStores();
