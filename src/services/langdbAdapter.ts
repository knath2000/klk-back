import { BaseLLMAdapter } from './llmAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';

export class LangDBAdapter extends BaseLLMAdapter {
  private activeRequests: Map<string, AbortController> = new Map();
  private activeStreams: Map<string, { reader: ReadableStreamDefaultReader<Uint8Array>; decoder: TextDecoder; controller: AbortController }> = new Map();
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;

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
      }, options.timeout || 30000); // Use same default as chat service

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

                if (delta?.content !== undefined) {
                  yield {
                    deltaText: delta.content || '',  // Send empty string instead of skipping
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
    // Validate environment variables
    if (!this.apiKey) {
      throw new Error('LANGDB_API_KEY environment variable is required');
    }
    if (!this.baseUrl) {
      throw new Error('LANGDB_BASE_URL environment variable is required');
    }

    const controller = new AbortController();
    const requestId = options.requestId || `req_${Date.now()}`;
    this.activeRequests.set(requestId, controller);

    let lastError: any = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`LangDB fetch attempt ${attempt}/${this.MAX_RETRIES} for ${requestId}: ${this.baseUrl}/chat/completions`);

        // Add timeout to prevent hanging requests
        const timeoutId = setTimeout(() => {
          console.warn(`Request ${requestId} attempt ${attempt} timed out, aborting...`);
          controller.abort();
        }, options.timeout || 30000);

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
          lastError = new Error(`LangDB API error: ${response.status} ${errorText}`);
          console.error(`Attempt ${attempt} failed:`, lastError.message);
          if (attempt < this.MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * attempt));
            continue;
          }
          throw lastError;
        }

        const data: any = await response.json();
        console.log(`✅ LangDB fetch success on attempt ${attempt} for ${requestId}:`, data.choices?.[0]?.message?.content?.substring(0, 100) + '...');
        return data.choices?.[0]?.message?.content || '';
      } catch (error: any) {
        lastError = error;
        console.error(`Attempt ${attempt} failed for ${requestId}:`, error.message);
        if (attempt < this.MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * attempt));
          continue;
        }
        throw lastError;
      } finally {
        this.activeRequests.delete(requestId);
      }
    }
    return '';
  }

  /**
   * Translator mode: Generate structured JSON output for translation queries
   * @param text The text to translate
   * @param sourceLang Source language (e.g., 'es')
   * @param targetLang Target language (e.g., 'en')
   * @param context Optional regional context (e.g., 'mex' for Mexican Spanish)
   * @returns Promise resolving to structured translation JSON
   */
  async translateStructured(
    text: string,
    sourceLang: string,
    targetLang: string,
    context?: string
  ): Promise<any> {
    const systemPrompt = `You are a precise Spanish-English translator. Output ONLY JSON: {
  "definitions": [{"meaning": "string", "pos": "noun|verb|adj|adv", "usage": "formal|informal|slang"}],
  "examples": [{"es": "Spanish example", "en": "English example", "context": "usage context"}],
  "conjugations": {"present": ["yo form", "tú form", ...], "past": [...], ...},
  "audio": {"ipa": "phonetic", "suggestions": ["audio file suggestions"]},
  "related": {"synonyms": ["syn1", "syn2"], "antonyms": ["ant1", "ant2"]}
}. Use regional variants if context provided.`;

    const userPrompt = `Translate "${text}" from ${sourceLang} to ${targetLang}${context ? ` with ${context} regional context` : ''}.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const options: LLMOptions = {
      model: 'gpt-4', // Use GPT-4 for better translation quality
      timeout: 30000,
      requestId: `translate_${Date.now()}`
    };

    try {
      const response = await this.fetchCompletion(messages, options);

      if (!response || response.trim() === '') {
        console.warn('Empty response from LangDB for translation:', text);
        return this.getFallbackTranslation(text, sourceLang, targetLang);
      }

      try {
        const parsed = JSON.parse(response);
        if (parsed.choices && Array.isArray(parsed.choices) && parsed.choices[0]?.message?.content) {
          return JSON.parse(parsed.choices[0].message.content); // Parse inner JSON
        } else {
          console.warn('Invalid LangDB response structure:', parsed);
          return this.getFallbackTranslation(text, sourceLang, targetLang);
        }
      } catch (parseError) {
        console.error('JSON parse error in translateStructured:', parseError, 'Raw response:', response);
        return this.getFallbackTranslation(text, sourceLang, targetLang);
      }
    } catch (error: any) {
      console.error('Translation fetch error:', error.message);
      return this.getFallbackTranslation(text, sourceLang, targetLang);
    }
  }

  private getFallbackTranslation(text: string, sourceLang: string, targetLang: string): any {
    console.log('🔄 Using fallback translation for:', text, 'due to LangDB failure');
    return {
      definitions: [{ meaning: `Fallback: "${text}" (service unavailable)`, pos: 'unknown', usage: 'general' }],
      examples: [{ es: text, en: 'Translation service temporarily unavailable', context: 'error' }],
      conjugations: {},
      audio: { ipa: '', suggestions: [] },
      related: { synonyms: [], antonyms: [] }
    };
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
