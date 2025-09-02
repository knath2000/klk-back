import { LLMMessage, DeltaChunk, LLMOptions } from '../types';

export interface ILLMAdapter {
  /**
   * Stream completion from the LLM
   * @param messages Array of messages to send to the LLM
   * @param options Configuration options including model, timeout, etc.
   * @returns Async iterable of delta chunks
   */
  streamCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): AsyncIterable<DeltaChunk>;

  /**
   * Get completion from the LLM (non-streaming)
   * @param messages Array of messages to send to the LLM
   * @param options Configuration options
   * @returns Promise resolving to the complete response
   */
  fetchCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): Promise<string>;

  /**
   * Cancel an ongoing request
   * @param requestId The request ID to cancel
   */
  cancel(requestId: string): Promise<void>;

  /**
   * Check if the adapter is ready to handle requests
   */
  isReady(): boolean;
}

export abstract class BaseLLMAdapter implements ILLMAdapter {
  protected apiKey: string;
  protected baseUrl: string;
  protected timeout: number;

  constructor(apiKey: string, baseUrl: string, timeout: number = 30000) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  abstract streamCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): AsyncIterable<DeltaChunk>;

  abstract fetchCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): Promise<string>;

  abstract cancel(requestId: string): Promise<void>;

  isReady(): boolean {
    return !!(this.apiKey && this.baseUrl);
  }
}