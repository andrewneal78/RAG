/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export interface RagStore {
    name: string;
    displayName: string;
}

export interface CustomMetadata {
  key?: string;
  stringValue?: string;
  stringListValue?: string[];
  numericValue?: number;
}

export interface Document {
    name: string;
    displayName: string;
    customMetadata?: CustomMetadata[];
}

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

export interface GroundingChunk {
    retrievedContext?: {
        text?: string;
        uri?: string;
        title?: string;
    };
    metadata?: DocumentMetadata;
    fileName?: string;
}

export interface QueryResult {
    text: string;
    groundingChunks: GroundingChunk[];
}

export enum AppStatus {
    Initializing,
    Welcome,
    Uploading,
    Chatting,
    Error,
}

export interface ChatMessage {
    role: 'user' | 'model';
    parts: { text: string }[];
    groundingChunks?: GroundingChunk[];
}
