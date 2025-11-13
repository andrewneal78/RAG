/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, GroundingChunk } from '../types';
import Spinner from './Spinner';
import SendIcon from './icons/SendIcon';
import RefreshIcon from './icons/RefreshIcon';

interface ChatInterfaceProps {
    documentName: string;
    history: ChatMessage[];
    isQueryLoading: boolean;
    onSendMessage: (message: string) => void;
    onNewChat: () => void;
    onReloadDocuments?: () => void;
    onResumeDocuments?: () => void;
    exampleQuestions: string[];
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ documentName, history, isQueryLoading, onSendMessage, onNewChat, onReloadDocuments, onResumeDocuments, exampleQuestions }) => {
    const [query, setQuery] = useState('');
    const [currentSuggestion, setCurrentSuggestion] = useState('');
    const [modalChunk, setModalChunk] = useState<GroundingChunk | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (exampleQuestions.length === 0) {
            setCurrentSuggestion('');
            return;
        }

        setCurrentSuggestion(exampleQuestions[0]);
        let suggestionIndex = 0;
        const intervalId = setInterval(() => {
            suggestionIndex = (suggestionIndex + 1) % exampleQuestions.length;
            setCurrentSuggestion(exampleQuestions[suggestionIndex]);
        }, 5000);

        return () => clearInterval(intervalId);
    }, [exampleQuestions]);
    
    const renderMarkdown = (text: string) => {
        if (!text) return { __html: '' };

        const lines = text.split('\n');
        let html = '';
        let listType: 'ul' | 'ol' | null = null;
        let paraBuffer = '';

        function flushPara() {
            if (paraBuffer) {
                html += `<p class="my-2">${paraBuffer}</p>`;
                paraBuffer = '';
            }
        }

        function flushList() {
            if (listType) {
                html += `</${listType}>`;
                listType = null;
            }
        }

        for (const rawLine of lines) {
            const line = rawLine
                .replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>')
                .replace(/\*(.*?)\*|_(.*?)_/g, '<em>$1$2</em>')
                .replace(/`([^`]+)`/g, '<code class="bg-gem-mist/50 px-1 py-0.5 rounded-sm font-mono text-sm">$1</code>');

            const isOl = line.match(/^\s*\d+\.\s(.*)/);
            const isUl = line.match(/^\s*[\*\-]\s(.*)/);

            if (isOl) {
                flushPara();
                if (listType !== 'ol') {
                    flushList();
                    html += '<ol class="list-decimal list-inside my-2 pl-5 space-y-1">';
                    listType = 'ol';
                }
                html += `<li>${isOl[1]}</li>`;
            } else if (isUl) {
                flushPara();
                if (listType !== 'ul') {
                    flushList();
                    html += '<ul class="list-disc list-inside my-2 pl-5 space-y-1">';
                    listType = 'ul';
                }
                html += `<li>${isUl[1]}</li>`;
            } else {
                flushList();
                if (line.trim() === '') {
                    flushPara();
                } else {
                    paraBuffer += (paraBuffer ? '<br/>' : '') + line;
                }
            }
        }

        flushPara();
        flushList();

        return { __html: html };
    };


    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            onSendMessage(query);
            setQuery('');
        }
    };

    const handleSourceClick = (chunk: GroundingChunk) => {
        setModalChunk(chunk);
    };

    const closeModal = () => {
        setModalChunk(null);
    };

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history, isQueryLoading]);

    return (
        <div className="flex flex-col h-full relative">
            <header className="absolute top-0 left-0 right-0 p-4 bg-gem-onyx/80 backdrop-blur-sm z-10 border-b border-gem-mist">
                <div className="w-full max-w-4xl mx-auto px-4">
                    <div className="flex justify-between items-start gap-4 mb-3">
                        <h1 className="text-2xl font-bold text-gem-offwhite flex-1" title={`Chat with ${documentName}`}>Chat with National Security Documents</h1>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {onResumeDocuments && (
                                <button
                                    onClick={onResumeDocuments}
                                    className="flex items-center px-3 py-2 bg-green-600 hover:bg-green-700 rounded-full text-white transition-colors flex-shrink-0"
                                    title="Continue uploading missing documents"
                                >
                                    <RefreshIcon />
                                    <span className="ml-2 hidden sm:inline">Resume</span>
                                </button>
                            )}
                            {onReloadDocuments && (
                                <button
                                    onClick={onReloadDocuments}
                                    className="flex items-center px-3 py-2 bg-gem-slate hover:bg-gem-mist rounded-full text-white transition-colors flex-shrink-0"
                                    title="Delete and reload all documents from scratch"
                                >
                                    <RefreshIcon />
                                    <span className="ml-2 hidden sm:inline">Reload</span>
                                </button>
                            )}
                            <button
                                onClick={onNewChat}
                                className="flex items-center px-3 py-2 bg-gem-blue hover:bg-blue-500 rounded-full text-white transition-colors flex-shrink-0"
                                title="Clear chat history"
                            >
                                <RefreshIcon />
                                <span className="ml-2 hidden sm:inline">Clear Chat</span>
                            </button>
                        </div>
                    </div>
                    <div className="text-sm text-gem-offwhite/70">{documentName}</div>
                </div>
            </header>

            <div className="flex-grow pt-24 pb-32 overflow-y-auto px-4">
                <div className="w-full max-w-4xl mx-auto space-y-6">
                    {history.map((message, index) => (
                        <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-xl lg:max-w-2xl px-5 py-3 rounded-2xl ${
                                message.role === 'user' 
                                ? 'bg-gem-blue text-white' 
                                : 'bg-gem-slate'
                            }`}>
                                <div dangerouslySetInnerHTML={renderMarkdown(message.parts[0].text)} />
                                {message.role === 'model' && message.groundingChunks && message.groundingChunks.length > 0 && (
                                    <div className="mt-4 pt-3 border-t border-gem-mist/50">
                                        <h4 className="text-xs font-semibold text-gem-offwhite/70 mb-2 text-right">Sources:</h4>
                                        <div className="flex flex-wrap gap-2 justify-end">
                                            {message.groundingChunks.map((chunk, chunkIndex) => {
                                                const metadata = chunk.metadata;
                                                const label = metadata
                                                    ? `${metadata.country} ${metadata.year} (${metadata.documentType})`
                                                    : `Source ${chunkIndex + 1}`;
                                                const title = metadata
                                                    ? `${metadata.documentName}\n${metadata.country} - ${metadata.year}\nType: ${metadata.documentType}`
                                                    : "View source document chunk";

                                                return chunk.retrievedContext?.text && (
                                                    <button
                                                        key={chunkIndex}
                                                        onClick={() => handleSourceClick(chunk)}
                                                        className="bg-gem-mist/50 hover:bg-gem-mist text-xs px-3 py-1 rounded-md transition-colors"
                                                        aria-label={`View source ${chunkIndex + 1}`}
                                                        title={title}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isQueryLoading && (
                        <div className="flex justify-start">
                            <div className="max-w-xl lg:max-w-2xl px-5 py-3 rounded-2xl bg-gem-slate flex items-center">
                                <Spinner />
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gem-onyx/80 backdrop-blur-sm">
                 <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-2 min-h-[3rem] flex items-center justify-center">
                        {!isQueryLoading && currentSuggestion && (
                            <button
                                onClick={() => setQuery(currentSuggestion)}
                                className="text-base text-gem-offwhite bg-gem-slate hover:bg-gem-mist transition-colors px-4 py-2 rounded-full"
                                title="Use this suggestion as your prompt"
                            >
                                Try: "{currentSuggestion}"
                            </button>
                        )}
                    </div>
                     <form onSubmit={handleSubmit} className="flex items-center space-x-3">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search national security documents..."
                            className="flex-grow bg-gem-mist border border-gem-mist/50 rounded-full py-3 px-5 focus:outline-none focus:ring-2 focus:ring-gem-blue"
                            disabled={isQueryLoading}
                        />
                        <button type="submit" disabled={isQueryLoading || !query.trim()} className="p-3 bg-gem-blue hover:bg-blue-500 rounded-full text-white disabled:bg-gem-mist transition-colors" title="Send message">
                            <SendIcon />
                        </button>
                    </form>
                </div>
            </div>

            {modalChunk !== null && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
                    onClick={closeModal}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="source-modal-title"
                >
                    <div className="bg-gem-slate p-6 rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <h3 id="source-modal-title" className="text-xl font-bold mb-3">Source Document</h3>

                        {modalChunk.metadata && (
                            <div className="bg-gem-mist/30 p-4 rounded-md mb-4 space-y-2 text-sm">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <span className="text-gem-offwhite/60 font-semibold">Document:</span>
                                        <p className="text-gem-offwhite">{modalChunk.metadata.documentName}</p>
                                    </div>
                                    <div>
                                        <span className="text-gem-offwhite/60 font-semibold">Country:</span>
                                        <p className="text-gem-offwhite">{modalChunk.metadata.country}</p>
                                    </div>
                                    <div>
                                        <span className="text-gem-offwhite/60 font-semibold">Year:</span>
                                        <p className="text-gem-offwhite">{modalChunk.metadata.year}</p>
                                    </div>
                                    <div>
                                        <span className="text-gem-offwhite/60 font-semibold">Type:</span>
                                        <p className="text-gem-offwhite">{modalChunk.metadata.documentType}</p>
                                    </div>
                                    {modalChunk.metadata.languages.length > 0 && (
                                        <div>
                                            <span className="text-gem-offwhite/60 font-semibold">Languages:</span>
                                            <p className="text-gem-offwhite">{modalChunk.metadata.languages.join(', ')}</p>
                                        </div>
                                    )}
                                    {modalChunk.metadata.publishingMinistry && (
                                        <div>
                                            <span className="text-gem-offwhite/60 font-semibold">Ministry:</span>
                                            <p className="text-gem-offwhite">{modalChunk.metadata.publishingMinistry}</p>
                                        </div>
                                    )}
                                </div>
                                {modalChunk.metadata.urlLink && (
                                    <div className="pt-2 border-t border-gem-mist/30">
                                        <a
                                            href={modalChunk.metadata.urlLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-gem-blue hover:text-blue-400 underline text-sm"
                                        >
                                            View original document
                                        </a>
                                    </div>
                                )}
                            </div>
                        )}

                        <h4 className="text-sm font-semibold text-gem-offwhite/70 mb-2">Relevant Excerpt:</h4>
                        <div
                            className="flex-grow overflow-y-auto pr-4 text-gem-offwhite/80 border-t border-b border-gem-mist py-4"
                            dangerouslySetInnerHTML={renderMarkdown(modalChunk.retrievedContext?.text || '')}
                        >
                        </div>
                        <div className="flex justify-end mt-4">
                            <button onClick={closeModal} className="px-6 py-2 rounded-md bg-gem-blue hover:bg-blue-500 text-white transition-colors" title="Close source view">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatInterface;
