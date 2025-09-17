import { BaseLLMAdapter } from './llmAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';
export declare class LangDBAdapter extends BaseLLMAdapter {
    private model;
    private activeRequests;
    private activeStreams;
    private readonly MAX_RETRIES;
    private readonly RETRY_BASE_DELAY;
    private cache;
    private readonly CACHE_TTL;
    private dnsCache;
    private readonly DNS_CACHE_TTL;
    private connectionPool;
    private readonly CONNECTION_POOL_TTL;
    private circuitBreakerState;
    private consecutiveFailures;
    private readonly CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    private readonly CIRCUIT_BREAKER_TIMEOUT;
    private lastFailureTime;
    constructor(apiKey: string, baseUrl: string);
    private shouldAllowRequest;
    private recordSuccess;
    private isGatewayTimeout;
    private recordFailure;
    private resolveDNSWithRetry;
    private getConnectionAgent;
    private cleanupResources;
    streamCompletion(messages: LLMMessage[], options: LLMOptions): AsyncIterable<DeltaChunk>;
    fetchCompletion(messages: LLMMessage[], options: LLMOptions): Promise<string>;
    /**
      * Translator mode: Generate structured JSON output for translation queries
      * Enhanced prompt engineering for comprehensive spanishdict.com-like results
      * @param text The text to translate
      * @param sourceLang Source language (e.g., 'es')
      * @param targetLang Target language (e.g., 'en')
      * @param context Optional regional context (e.g., 'mex' for Mexican Spanish)
      * @returns Promise resolving to structured translation JSON
      */
    translateStructured(text: string, sourceLang: string, targetLang: string, context?: string): Promise<any>;
    private getFallbackTranslation;
    getCircuitBreakerState(): string;
    cleanupCache(): void;
    cancel(requestId: string): Promise<void>;
}
export declare const translationService: LangDBAdapter;
//# sourceMappingURL=langdbAdapter.d.ts.map