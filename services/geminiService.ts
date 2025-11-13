/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { QueryResult } from '../types';

const API_BASE_URL = 'http://localhost:3001/api';

export function initialize() {
    // No longer needed - backend handles initialization
    console.log('Frontend service initialized');
}

export interface CreateRagStoreResult {
    ragStoreName: string;
    fileNames: string[];
    skippedFiles?: string[];
    failedFiles?: Array<{ fileName: string; error: string }>;
    exampleQuestions: string[];
    cached: boolean;
    resumeMode?: boolean;
    documentCount: number;
    targetCount: number;
}

export async function createRagStoreAndUploadDocuments(
    onProgress: (current: number, total: number, message: string, fileName?: string) => void,
    forceReload: boolean = false,
    resumeMode: boolean = false
): Promise<CreateRagStoreResult> {
    const response = await fetch(`${API_BASE_URL}/rag-store/create`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ forceReload, resumeMode }),
    });

    if (!response.ok) {
        throw new Error(`Failed to create RAG store: ${response.statusText}`);
    }

    // Handle Server-Sent Events for progress updates
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let ragStoreName = '';
    let fileNames: string[] = [];
    let skippedFiles: string[] = [];
    let failedFiles: Array<{ fileName: string; error: string }> = [];
    let exampleQuestions: string[] = [];
    let cached = false;
    let resumeModeResult = false;
    let documentCount = 0;
    let targetCount = 607;

    // Buffer for incomplete SSE messages
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Append new chunk to buffer
            buffer += decoder.decode(value, { stream: true });

            // Process complete lines (ending with \n)
            const lines = buffer.split('\n');

            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const jsonStr = line.substring(6).trim();
                        if (!jsonStr) continue; // Skip empty data lines

                        const data = JSON.parse(jsonStr);

                        if (data.type === 'progress') {
                            onProgress(
                                data.current || 0,
                                data.total || 1,
                                data.message || '',
                                data.fileName
                            );
                        } else if (data.type === 'complete') {
                            ragStoreName = data.ragStoreName;
                            fileNames = data.fileNames;
                            skippedFiles = data.skippedFiles || [];
                            failedFiles = data.failedFiles || [];
                            exampleQuestions = data.exampleQuestions;
                            cached = data.cached || false;
                            resumeModeResult = data.resumeMode || false;
                            documentCount = data.documentCount || 0;
                            targetCount = data.targetCount || 607;
                        } else if (data.type === 'error') {
                            throw new Error(data.message);
                        }
                    } catch (parseError) {
                        console.error('Failed to parse SSE message:', line, parseError);
                        // Continue processing other messages
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    if (!ragStoreName) {
        throw new Error('Failed to create RAG store');
    }

    return { ragStoreName, fileNames, skippedFiles, failedFiles, exampleQuestions, cached, resumeMode: resumeModeResult, documentCount, targetCount };
}

export async function fileSearch(ragStoreName: string, query: string): Promise<QueryResult> {
    const response = await fetch(`${API_BASE_URL}/rag-store/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ragStoreName, query }),
    });

    if (!response.ok) {
        throw new Error(`Query failed: ${response.statusText}`);
    }

    return await response.json();
}

export async function deleteRagStore(ragStoreName: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/rag-store/${encodeURIComponent(ragStoreName)}`, {
        method: 'DELETE',
    });

    if (!response.ok) {
        throw new Error(`Failed to delete RAG store: ${response.statusText}`);
    }
}
