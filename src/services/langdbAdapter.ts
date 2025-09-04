import { BaseLLMAdapter } from './llmAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';

export class LangDBAdapter extends BaseLLMAdapter {
  private activeRequests: Map<string, AbortController> = new Map();
  private activeStreams: Map<string, { reader: ReadableStreamDefaultReader<Uint8Array>; decoder: TextDecoder; controller: AbortController }> = new Map();

  async *streamCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): AsyncIterable<DeltaChunk> {
    const controller = new AbortController();
    const requestId = options.requestId || `req_${Date.now()}`;

    this.activeRequests.set(requestId, controller);

    let response: Response | null = null;

    try {
      // Add timeout to prevent hanging requests
      const timeoutId = setTimeout(() => {
        console.warn(`Request ${requestId} timed out, aborting...`);
        controller.abort();
      }, options.timeout || 60000);

      // Use native fetch (Node.js 18+)
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          stream: true,
          max_tokens: 1000,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LangDB API error: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      // Use proper streaming with native ReadableStream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Store stream resources for cleanup
      this.activeStreams.set(requestId, { reader, decoder, controller });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines from buffer
          while (true) {
            const lineEnd = buffer.indexOf('\n');
            if (lineEnd === -1) break;

            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                yield { isFinal: true };
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                if (delta?.content) {
                  yield {
                    deltaText: delta.content,
                    isFinal: false,
                    meta: {
                      usage: parsed.usage,
                      requestId: parsed.id
                    }
                  };
                }
              } catch (parseError) {
                // Skip invalid JSON lines but log for debugging
                console.warn(`Failed to parse streaming response for ${requestId}:`, parseError instanceof Error ? parseError.message : String(parseError));
              }
            }
          }
        }
      } finally {
        // Ensure reader is always released
        if (reader) {
          try {
            await reader.cancel();
          } catch (cancelError) {
            console.warn(`Failed to cancel reader for ${requestId}:`, cancelError);
          }
        }
        // Clean up stream resources
        this.activeStreams.delete(requestId);
      }
    } catch (error: any) {
      // Handle abort errors properly
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        console.log(`Request ${requestId} was cancelled`);
      } else {
        console.error(`Streaming error for ${requestId}:`, {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        throw error;
      }
    } finally {
      // Ensure cleanup happens even if error occurs
      this.activeRequests.delete(requestId);
    }
  }

  async fetchCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): Promise<string> {
    const controller = new AbortController();
    const requestId = options.requestId || `req_${Date.now()}`;

    this.activeRequests.set(requestId, controller);

    try {
      // Add timeout to prevent hanging requests
      const timeoutId = setTimeout(() => {
        console.warn(`Request ${requestId} timed out, aborting...`);
        controller.abort();
      }, options.timeout || 30000); // 30 second default timeout

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          stream: false,
          max_tokens: 1000,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LangDB API error: ${response.status} ${errorText}`);
      }

      const data: any = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        console.log(`Request ${requestId} was cancelled`);
        return '';
      } else {
        console.error(`Completion error for ${requestId}:`, {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        // On error, return empty string so callers always get a string
        return '';
      }
    } finally {
      // Ensure cleanup happens even if error occurs
      this.activeRequests.delete(requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    const controller = this.activeRequests.get(requestId);
    const streamResources = this.activeStreams.get(requestId);

    if (controller) {
      try {
        controller.abort();
        console.log(`Request ${requestId} cancelled successfully`);
      } catch (error) {
        console.warn(`Error cancelling request ${requestId}:`, error);
      }
    }

    // Clean up stream resources
    if (streamResources) {
      try {
        const { reader } = streamResources;
        if (reader) {
          await reader.cancel();
        }
      } catch (error) {
        console.warn(`Error cleaning up stream resources for ${requestId}:`, error);
      }
    }

    // Remove from tracking maps
    this.activeRequests.delete(requestId);
    this.activeStreams.delete(requestId);
  }
}
