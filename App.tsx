/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef } from 'react';
import { AppStatus, ChatMessage } from './types';
import * as geminiService from './services/geminiService';
import Spinner from './components/Spinner';
import ProgressBar from './components/ProgressBar';
import ChatInterface from './components/ChatInterface';

const App: React.FC = () => {
    const [status, setStatus] = useState<AppStatus>(AppStatus.Initializing);
    const [error, setError] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number, message?: string, fileName?: string } | null>(null);
    const [activeRagStoreName, setActiveRagStoreName] = useState<string | null>(null);
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [isQueryLoading, setIsQueryLoading] = useState(false);
    const [exampleQuestions, setExampleQuestions] = useState<string[]>([]);
    const [documentName, setDocumentName] = useState<string>('');
    const ragStoreNameRef = useRef(activeRagStoreName);

    useEffect(() => {
        ragStoreNameRef.current = activeRagStoreName;
    }, [activeRagStoreName]);

    // No longer delete RAG store on unload - it's now persistent
    // useEffect(() => {
    //     const handleUnload = () => {
    //         if (ragStoreNameRef.current) {
    //             geminiService.deleteRagStore(ragStoreNameRef.current)
    //                 .catch(err => console.error("Error deleting RAG store on unload:", err));
    //         }
    //     };

    //     window.addEventListener('beforeunload', handleUnload);

    //     return () => {
    //         window.removeEventListener('beforeunload', handleUnload);
    //     };
    // }, []);


    const handleError = (message: string, err: any) => {
        console.error(message, err);
        setError(`${message}${err ? `: ${err instanceof Error ? err.message : String(err)}` : ''}`);
        setStatus(AppStatus.Error);
    };

    const clearError = () => {
        setError(null);
        loadDocuments();
    }

    const loadDocuments = async (forceReload: boolean = false, resumeMode: boolean = false) => {
        setStatus(AppStatus.Uploading);
        setUploadProgress({ current: 0, total: 1, message: "Initializing..." });

        try {
            geminiService.initialize();

            const result = await geminiService.createRagStoreAndUploadDocuments(
                (current, total, message, fileName) => {
                    setUploadProgress({ current, total, message, fileName });
                },
                forceReload,
                resumeMode
            );

            setUploadProgress({ current: result.fileNames.length + 2, total: result.fileNames.length + 2, message: "All set!", fileName: "" });

            await new Promise(resolve => setTimeout(resolve, 500)); // Short delay to show "All set!"

            let docName: string;
            const countInfo = `(${result.documentCount}/${result.targetCount})`;
            const percentComplete = Math.round((result.documentCount / result.targetCount) * 100);

            if (result.cached) {
                docName = `National Security Documents ${countInfo} - ${percentComplete}%`;
            } else if (result.fileNames.length === 0) {
                docName = `National Security Documents ${countInfo}`;
            } else if (result.fileNames.length === 1) {
                docName = `${result.fileNames[0]} ${countInfo}`;
            } else if (result.fileNames.length === 2) {
                docName = `${result.fileNames[0]} & ${result.fileNames[1]} ${countInfo}`;
            } else {
                docName = `${result.fileNames.length} documents ${countInfo} - ${percentComplete}%`;
            }

            setDocumentName(docName);
            setExampleQuestions(result.exampleQuestions);
            setActiveRagStoreName(result.ragStoreName);
            setChatHistory([]);

            // Warn user if some files failed to upload
            if (result.failedFiles && result.failedFiles.length > 0) {
                console.warn(`${result.failedFiles.length} files failed to upload:`, result.failedFiles);
                const warningMessage: ChatMessage = {
                    role: 'model',
                    parts: [{
                        text: `Note: ${result.failedFiles.length} out of ${result.fileNames.length + result.failedFiles.length} files failed to upload. The chat will work with ${result.documentCount} successfully uploaded documents. Check the console for details.`
                    }]
                };
                setChatHistory([warningMessage]);
            }

            setStatus(AppStatus.Chatting);
        } catch (err) {
            handleError("Failed to load documents", err);
        } finally {
            setUploadProgress(null);
        }
    };

    useEffect(() => {
        loadDocuments();
    }, []);

    const handleEndChat = () => {
        // Don't delete RAG store - it's persistent now
        setChatHistory([]);
        // Keep using the same RAG store and questions
    };

    const handleReloadDocuments = () => {
        setChatHistory([]);
        setExampleQuestions([]);
        setDocumentName('');
        loadDocuments(true, false); // Force reload (delete and re-upload all)
    };

    const handleResumeDocuments = () => {
        setChatHistory([]);
        setExampleQuestions([]);
        setDocumentName('');
        loadDocuments(false, true); // Resume mode (upload only missing documents)
    };

    const handleSendMessage = async (message: string) => {
        if (!activeRagStoreName) return;

        const userMessage: ChatMessage = { role: 'user', parts: [{ text: message }] };
        setChatHistory(prev => [...prev, userMessage]);
        setIsQueryLoading(true);

        try {
            const result = await geminiService.fileSearch(activeRagStoreName, message);
            const modelMessage: ChatMessage = {
                role: 'model',
                parts: [{ text: result.text }],
                groundingChunks: result.groundingChunks
            };
            setChatHistory(prev => [...prev, modelMessage]);
        } catch (err) {
            const errorMessage: ChatMessage = {
                role: 'model',
                parts: [{ text: "Sorry, I encountered an error. Please try again." }]
            };
            setChatHistory(prev => [...prev, errorMessage]);
            handleError("Failed to get response", err);
        } finally {
            setIsQueryLoading(false);
        }
    };
    
    const renderContent = () => {
        switch(status) {
            case AppStatus.Uploading:
                let icon = null;
                if (uploadProgress?.message === "Creating document index...") {
                    icon = <img src="https://services.google.com/fh/files/misc/applet-upload.png" alt="Uploading files icon" className="h-80 w-80 rounded-lg object-cover" />;
                } else if (uploadProgress?.message === "Generating embeddings...") {
                    icon = <img src="https://services.google.com/fh/files/misc/applet-creating-embeddings_2.png" alt="Creating embeddings icon" className="h-240 w-240 rounded-lg object-cover" />;
                } else if (uploadProgress?.message === "Generating suggestions...") {
                    icon = <img src="https://services.google.com/fh/files/misc/applet-suggestions_2.png" alt="Generating suggestions icon" className="h-240 w-240 rounded-lg object-cover" />;
                } else if (uploadProgress?.message === "All set!") {
                    icon = <img src="https://services.google.com/fh/files/misc/applet-completion_2.png" alt="Completion icon" className="h-240 w-240 rounded-lg object-cover" />;
                }

                return <ProgressBar 
                    progress={uploadProgress?.current || 0} 
                    total={uploadProgress?.total || 1} 
                    message={uploadProgress?.message || "Preparing your chat..."} 
                    fileName={uploadProgress?.fileName}
                    icon={icon}
                />;
            case AppStatus.Chatting:
                return <ChatInterface
                    documentName={documentName}
                    history={chatHistory}
                    isQueryLoading={isQueryLoading}
                    onSendMessage={handleSendMessage}
                    onNewChat={handleEndChat}
                    onReloadDocuments={handleReloadDocuments}
                    onResumeDocuments={handleResumeDocuments}
                    exampleQuestions={exampleQuestions}
                />;
            case AppStatus.Error:
                 return (
                    <div className="flex flex-col items-center justify-center h-screen bg-red-900/20 text-red-300">
                        <h1 className="text-3xl font-bold mb-4">Application Error</h1>
                        <p className="max-w-md text-center mb-4">{error}</p>
                        <button onClick={clearError} className="px-4 py-2 rounded-md bg-gem-mist hover:bg-gem-mist/70 transition-colors" title="Reload documents">
                           Try Again
                        </button>
                    </div>
                );
            default:
                 return (
                    <div className="flex items-center justify-center h-screen">
                        <Spinner /> <span className="ml-4 text-xl">Loading...</span>
                    </div>
                );
        }
    }

    return (
        <main className="h-screen bg-gem-onyx text-gem-offwhite">
            {renderContent()}
        </main>
    );
};

export default App;
