import { BaseLLMAdapter } from './llmAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';
export declare class LangDBAdapter extends BaseLLMAdapter {
    private activeRequests;
    private activeStreams;
    streamCompletion(messages: LLMMessage[], options: LLMOptions): AsyncIterable<DeltaChunk>;
    fetchCompletion(messages: LLMMessage[], options: LLMOptions): Promise<string>;
    /**
     * Translator mode: Generate structured JSON output for translation queries
     * @param text The text to translate
     * @param sourceLang Source language (e.g., 'es')
     * @param targetLang Target language (e.g., 'en')
     * @param context Optional regional context (e.g., 'mex' for Mexican Spanish)
     * @returns Promise resolving to structured translation JSON
     */
    translateStructured(text: string, sourceLang: string, targetLang: string, context?: string): Promise<any>;
    cancel(requestId: string): Promise<void>;
}
//# sourceMappingURL=langdbAdapter.d.ts.map