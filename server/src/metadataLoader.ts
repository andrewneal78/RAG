/**
 * Metadata loader for national security documents
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export interface DocumentMetadata {
    filePrefix: string;
    documentName: string;
    country: string;
    documentType: string; // NSS, WP, DD
    isoAlpha3: string;
    m49Code: string;
    year: string;
    leadersPreamble: boolean;
    length: number;
    segmentCount: number;
    wordCount: number;
    languages: string[];
    publishingMinistry: string;
    urlLink: string;
}

const METADATA_PATH = '/Users/aneal/Library/CloudStorage/OneDrive-UniversityofEdinburgh/ns_codebase_main/document_processing/data/metadata/document_metadata.csv';

let metadataCache: Map<string, DocumentMetadata> | null = null;

export function loadMetadata(): Map<string, DocumentMetadata> {
    if (metadataCache) {
        return metadataCache;
    }

    console.log('Loading document metadata from CSV...');

    const csvContent = fs.readFileSync(METADATA_PATH, 'utf-8');
    const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
    });

    const metadata = new Map<string, DocumentMetadata>();

    for (const record of records) {
        // Extract languages (up to 11 columns)
        const languages: string[] = [];
        for (let i = 1; i <= 11; i++) {
            const lang = record[`Language ${i}`];
            if (lang && lang.trim()) {
                languages.push(lang.trim());
            }
        }

        const filePrefix = record['File prefix'];

        metadata.set(filePrefix, {
            filePrefix,
            documentName: record['Document'],
            country: record['Country'],
            documentType: record['NSS/WP/DD'],
            isoAlpha3: record['ISO Alpha-3 Code'],
            m49Code: record['M49 code'],
            year: record['Year'],
            leadersPreamble: record["Leader's preamble"] === 'Y',
            length: parseInt(record['Length']) || 0,
            segmentCount: parseInt(record['segment_count']) || 0,
            wordCount: parseInt(record['word_count']) || 0,
            languages,
            publishingMinistry: record['Publishing Ministry'],
            urlLink: record['URL Link to Docs']
        });
    }

    console.log(`Loaded metadata for ${metadata.size} documents`);
    metadataCache = metadata;

    return metadata;
}

export function getMetadataForFile(fileName: string): DocumentMetadata | null {
    const metadata = loadMetadata();

    // Extract file prefix from filename (e.g., "183 Japan Defense..." -> "183")
    const match = fileName.match(/^(\d+)\s/);
    if (!match) {
        console.warn(`Could not extract file prefix from: ${fileName}`);
        return null;
    }

    const prefix = match[1];
    return metadata.get(prefix) || null;
}

export function getAllMetadata(): Map<string, DocumentMetadata> {
    return loadMetadata();
}
