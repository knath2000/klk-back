import { BaseLLMAdapter } from './llmAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';

export class OpenRouterAdapter extends BaseLLMAdapter {
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
      // Log before OpenRouter call
      console.log(`[OpenRouter] streamCompletion called for request ${requestId}`);
      console.log(`[OpenRouter] API key present: ${!!this.apiKey ? `${this.apiKey.slice(0, 10)}...` : 'NO KEY'}`);
      console.log(`[OpenRouter] Model: ${options.model}, Messages length: ${messages.length}`);
      // Validate model before proceeding
      const body: any = {
        model: options.model,
        messages,
        stream: true,
        max_tokens: 1000,
      };
      if (typeof options.temperature === 'number') {
        body.temperature = options.temperature;
      }
      // Prefers json_schema if provided, otherwise allow a raw response_format
      if (options.jsonSchema) {
        body.response_format = { type: 'json_schema', json_schema: options.jsonSchema };
      } else if (options.responseFormat) {
        body.response_format = options.responseFormat;
      }

      console.log(`[OpenRouter] Fetching ${this.baseUrl}/chat/completions with model ${options.model} for request ${requestId}`);

      const fullUrl = `${this.baseUrl}/chat/completions`;
      console.log(`[OpenRouter] Full request details for ${requestId}:`);
      console.log(`  Method: POST`);
      console.log(`  URL: ${fullUrl}`);
      console.log(`  Headers: Authorization=Bearer ${this.apiKey ? '[REDACTED]' : 'MISSING'}, Content-Type=application/json`);
      console.log(`  Body:`, JSON.stringify(body, null, 2));

      const timeoutId = setTimeout(() => {
        console.error(`[OpenRouter] Request ${requestId} timeout after 30s - aborting`);
        controller.abort();
      }, 30000); // 30s timeout

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log(`[OpenRouter] Fetch response status: ${response.status} for request ${requestId}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenRouter] API error ${response.status}: ${errorText} for request ${requestId}`);
        throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      console.log(`[OpenRouter] Starting stream processing for request ${requestId}`);

      // Use proper streaming with native ReadableStream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Store stream resources for cleanup
      this.activeStreams.set(requestId, { reader, decoder, controller });

      let hasChunks = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log(`[OpenRouter] Stream complete for request ${requestId}, hasChunks: ${hasChunks}`);
            yield { isFinal: true };
            break;
          }

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
                console.log(`[OpenRouter] Stream ended with [DONE] for request ${requestId}`);
                yield { isFinal: true };
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                if (delta?.content) {
                  hasChunks = true;
                  console.log(`[OpenRouter] Yielding chunk of length ${delta.content.length} for request ${requestId}`);
                  yield {
                    deltaText: delta.content,
                    isFinal: false,
                    meta: {
                      usage: parsed.usage,
                      requestId: parsed.id
                    }
                  };
                } else if (delta && !delta.content) {
                  // Tolerate empty deltas but log them for debugging
                  console.log(`[OpenRouter] Empty delta received for request ${requestId} - tolerating`);
                } else if (!delta) {
                  console.log(`[OpenRouter] No delta in parsed response for request ${requestId} - skipping`);
                }
              } catch (parseError) {
                console.warn(`[OpenRouter] Failed to parse line "${line}" for request ${requestId}:`, parseError);
                // Skip invalid JSON lines
              }
            }
          }
        }

        // Check for no chunks after loop
        if (!hasChunks) {
          console.error(`[OpenRouter] No chunks received for request ${requestId} - possible API issue or empty response`);
          throw new Error('No response chunks received from OpenRouter');
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
      console.error(`[OpenRouter] StreamCompletion error for request ${requestId}:`, error);
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        console.log(`Request ${requestId} was cancelled`);
      } else {
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
      // Similar logging for non-streaming
      console.log(`[OpenRouter] fetchCompletion called for request ${requestId}`);
      console.log(`[OpenRouter] API key present: ${!!this.apiKey ? `${this.apiKey.slice(0, 10)}...` : 'NO KEY'}`);
      console.log(`[OpenRouter] Model: ${options.model}, Messages length: ${messages.length}`);

      const body: any = {
        model: options.model,
        messages,
        stream: false,
        max_tokens: 1000,
      };
      if (typeof options.temperature === 'number') {
        body.temperature = options.temperature;
      }
      if (options.jsonSchema) {
        body.response_format = { type: 'json_schema', json_schema: options.jsonSchema };
      } else if (options.responseFormat) {
        body.response_format = options.responseFormat;
      }

      const timeoutId = setTimeout(() => {
        console.error(`[OpenRouter] fetchCompletion timeout after 30s for request ${requestId} - aborting`);
        controller.abort();
      }, 30000);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log(`[OpenRouter] fetchCompletion response status: ${response.status} for request ${requestId}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenRouter] API error ${response.status}: ${errorText} for request ${requestId}`);
        throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
      }

      const data: any = await response.json();
      const combinedContent = Array.isArray(data?.choices)
        ? data.choices
            .map((choice: any) => choice?.message?.content ?? '')
            .join('')
            .trim()
        : '';
      console.log(
        `[OpenRouter] fetchCompletion completed for request ${requestId}, content length: ${combinedContent.length}`
      );
      return combinedContent;
    } catch (error: any) {
      console.error(`[OpenRouter] fetchCompletion error for request ${requestId}:`, error);
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        console.log(`Request ${requestId} was cancelled`);
        return '';
      } else {
        // On error, return empty string so callers always get a string
        return '';
      }
    } finally {
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
