import { BaseLLMAdapter } from './llmAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';

export class LangDBAdapter extends BaseLLMAdapter {
  private model: string;
  private activeRequests: Map<string, AbortController> = new Map();
  private activeStreams: Map<string, { reader: ReadableStreamDefaultReader<Uint8Array>; decoder: TextDecoder; controller: AbortController }> = new Map();
  private readonly MAX_RETRIES = 5; // Increased from 3
  private readonly RETRY_BASE_DELAY = 2000; // Increased base delay
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes

  constructor(apiKey: string, baseUrl: string) {
    super(apiKey, baseUrl);

    if (!apiKey) {
      throw new Error('LANGDB_API_KEY is required for LangDBAdapter');
    }
    if (!baseUrl) {
      throw new Error('LANGDB_BASE_URL is required for LangDBAdapter');
    }

    let model = process.env.LANGDB_MODEL || 'openai/gpt-5-mini';
    if (!['gpt-4o-mini', 'llama-3.1-8b', 'openai/gpt-4o-mini', 'openai/gpt-5-mini'].includes(model)) {
      console.warn(`Invalid LANGDB_MODEL "${model}"; defaulting to "openai/gpt-5-mini" (verify LangDB support)`);
      model = 'openai/gpt-5-mini';
    }
    this.model = model;

    console.log('LangDBAdapter initialized with tenant URL:', baseUrl, 'model:', model);
  }

  async *streamCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): AsyncIterable<DeltaChunk> {
    const requestId = options.requestId || `req_${Date.now()}`;
    let response: Response | null = null;
    let controller = new AbortController();

    try {
      // Environment-based timeout
      const timeoutMs = parseInt(process.env.LANGDB_TIMEOUT || '90000');
      const timeoutId = setTimeout(() => {
        console.warn(`Request ${requestId} timed out, aborting...`);
        controller.abort();
      }, timeoutMs);

      // Model-specific parameter mapping for gpt-5-mini
      const isGpt5Mini = options.model === 'openai/gpt-5-mini';
      const maxTokensParam = isGpt5Mini ? 'max_completion_tokens' : 'max_tokens';

      const bodyParams = {
        model: options.model,
        messages,
        stream: true,
        [maxTokensParam]: 1000,
      };

      if (!isGpt5Mini) {
        bodyParams.temperature = 0.7;
      }

      // Use native fetch (Node.js 18+) with keep-alive headers
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=30',
        },
        body: JSON.stringify(bodyParams),
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

    let lastError: any = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      const controller = new AbortController(); // New controller for each attempt
      const requestId = options.requestId || `req_${Date.now()}`;
      this.activeRequests.set(requestId, controller);

      try {
        console.log(`🔄 LangDB fetch attempt ${attempt}/${this.MAX_RETRIES} for ${requestId}: ${this.baseUrl}/chat/completions`);

        // Add timeout to prevent hanging requests
        const timeoutMs = parseInt(process.env.LANGDB_TIMEOUT || '90000');
        const timeoutId = setTimeout(() => {
          console.warn(`Request ${requestId} attempt ${attempt} timed out, aborting...`);
          controller.abort();
        }, timeoutMs);

        // Model-specific parameter mapping for gpt-5-mini
        const isGpt5Mini = options.model === 'openai/gpt-5-mini';
        const maxTokensParam = isGpt5Mini ? 'max_completion_tokens' : 'max_tokens';

        const bodyParams = {
          model: options.model,
          messages,
          stream: false,
          [maxTokensParam]: 1000,
        };

        if (!isGpt5Mini) {
          bodyParams.temperature = 0.7;
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
            'Keep-Alive': 'timeout=30',
          },
          body: JSON.stringify(bodyParams),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const fullBody = await response.text();
          console.error('Full LangDB response body on failure (attempt ${attempt}):', fullBody.substring(0, 1000)); // Log full body
          lastError = new Error(`LangDB API error: ${response.status} - ${fullBody || 'Empty body'}`);
          console.error(`❌ Attempt ${attempt} failed:`, lastError.message);
          console.error('Response details:', {
            status: response.status,
            statusText: response.statusText,
            body: fullBody
          });
          if (attempt < this.MAX_RETRIES) {
            const delay = this.RETRY_BASE_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw lastError;
        }

        const data: any = await response.json();
        console.log(`✅ LangDB fetch success on attempt ${attempt} for ${requestId}: keys: ${Object.keys(data)}`);
        return data.choices?.[0]?.message?.content || '';
      } catch (error: any) {
        lastError = error;
        console.error(`❌ LangDB fetch attempt ${attempt} failed for ${requestId}:`, {
          message: error.message,
          name: error.name,
          code: error.code, // e.g., 'UND_ERR_CONNECTING' for network
          stack: error.stack
        });
        if (attempt < this.MAX_RETRIES) {
          const delay = this.RETRY_BASE_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
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
      model: 'openai/gpt-5-mini', // Updated to use gpt-5-mini for translation (more advanced model for structured outputs)
      timeout: 90000, // Increased for Render
      requestId: `translate_${Date.now()}`
    };

    try {
      const response = await this.fetchCompletion(messages, options);

      if (!response || response.trim() === '') {
        console.warn('Empty response from LangDB for translation:', text);
        return this.getFallbackTranslation(text, sourceLang, targetLang);
      }

      // Log raw response for debugging
      console.log('Raw LangDB translation response:', response.substring(0, 500) + (response.length > 500 ? '...' : ''));

      try {
        // Since we prompt for direct JSON output, parse the response content directly
        const structured = JSON.parse(response.trim());

        // Validate structure: must have definitions array and other expected keys
        if (structured.definitions && Array.isArray(structured.definitions) &&
            structured.examples && Array.isArray(structured.examples) &&
            typeof structured.conjugations === 'object' &&
            typeof structured.audio === 'object' &&
            typeof structured.related === 'object') {
          console.log('✅ Valid structured translation parsed from LangDB');
          return structured;
        } else {
          console.warn('Invalid LangDB structure (missing expected keys or invalid types):', {
            hasDefinitions: !!structured.definitions,
            definitionsType: Array.isArray(structured.definitions) ? 'array' : typeof structured.definitions,
            hasExamples: !!structured.examples,
            // Add more validation logs as needed
          });
          return this.getFallbackTranslation(text, sourceLang, targetLang);
        }
      } catch (parseError) {
        console.error('JSON parse error in translateStructured:', parseError instanceof Error ? parseError.message : String(parseError), 'Raw response:', response.substring(0, 500) + (response.length > 500 ? '...' : ''));
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
      definitions: [
        {
          text: `Error: "${text}" (both services unavailable)`,
          meaning: `Error: "${text}" (both services unavailable)`,
          pos: 'unknown',
          usage: 'error'
        }
      ],
      examples: [],
      conjugations: {},
      audio: { ipa: '', suggestions: [] },
      related: { synonyms: [], antonyms: [] }
    };
  }

  cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
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

// Singleton instance
export const translationService = new LangDBAdapter(
  process.env.LANGDB_API_KEY || '',
  process.env.LANGDB_GATEWAY_URL || 'https://api.us-east-1.langdb.ai/v1'
);

// Periodic cache cleanup
setInterval(() => {
  translationService.cleanupCache();
}, 1000 * 60 * 5); // Every 5 minutes
