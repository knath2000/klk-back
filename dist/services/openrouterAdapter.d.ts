import { BaseLLMAdapter } from './llmAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';
export declare class OpenRouterAdapter extends BaseLLMAdapter {
    private activeRequests;
    private activeStreams;
    streamCompletion(messages: LLMMessage[], options: LLMOptions): AsyncIterable<DeltaChunk>;
    fetchCompletion(messages: LLMMessage[], options: LLMOptions): Promise<string>;
    cancel(requestId: string): Promise<void>;
}
//# sourceMappingURL=openrouterAdapter.d.ts.map