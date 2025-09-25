"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterAdapter = void 0;
const llmAdapter_1 = require("./llmAdapter");
class OpenRouterAdapter extends llmAdapter_1.BaseLLMAdapter {
    constructor() {
        super(...arguments);
        this.activeRequests = new Map();
        this.activeStreams = new Map();
    }
    async *streamCompletion(messages, options) {
        const controller = new AbortController();
        const requestId = options.requestId || `req_${Date.now()}`;
        this.activeRequests.set(requestId, controller);
        let response = null;
        try {
            const body = {
                model: options.model,
                messages,
                stream: true,
                max_tokens: 1000,
            };
            if (typeof options.temperature === 'number') {
                body.temperature = options.temperature;
            }
            // Prefer json_schema if provided, otherwise allow a raw response_format
            if (options.jsonSchema) {
                body.response_format = { type: 'json_schema', json_schema: options.jsonSchema };
            }
            else if (options.responseFormat) {
                body.response_format = options.responseFormat;
            }
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
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
                    if (done)
                        break;
                    buffer += decoder.decode(value, { stream: true });
                    // Process complete lines from buffer
                    while (true) {
                        const lineEnd = buffer.indexOf('\n');
                        if (lineEnd === -1)
                            break;
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
                            }
                            catch (parseError) {
                                // Skip invalid JSON lines
                                console.warn('Failed to parse streaming response:', parseError);
                            }
                        }
                    }
                }
            }
            finally {
                // Ensure reader is always released
                if (reader) {
                    try {
                        await reader.cancel();
                    }
                    catch (cancelError) {
                        console.warn(`Failed to cancel reader for ${requestId}:`, cancelError);
                    }
                }
                // Clean up stream resources
                this.activeStreams.delete(requestId);
            }
        }
        catch (error) {
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                console.log(`Request ${requestId} was cancelled`);
            }
            else {
                console.error('Streaming error:', error);
                throw error;
            }
        }
        finally {
            // Ensure cleanup happens even if error occurs
            this.activeRequests.delete(requestId);
        }
    }
    async fetchCompletion(messages, options) {
        const controller = new AbortController();
        const requestId = options.requestId || `req_${Date.now()}`;
        this.activeRequests.set(requestId, controller);
        try {
            const body = {
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
            }
            else if (options.responseFormat) {
                body.response_format = options.responseFormat;
            }
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
            }
            const data = await response.json();
            return data.choices?.[0]?.message?.content || '';
        }
        catch (error) {
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                console.log(`Request ${requestId} was cancelled`);
                return '';
            }
            else {
                console.error(`Completion error for ${requestId}:`, error);
                // On error, return empty string so callers always get a string
                return '';
            }
        }
        finally {
            // Ensure cleanup happens even if error occurs
            this.activeRequests.delete(requestId);
        }
    }
    async cancel(requestId) {
        const controller = this.activeRequests.get(requestId);
        const streamResources = this.activeStreams.get(requestId);
        if (controller) {
            try {
                controller.abort();
                console.log(`Request ${requestId} cancelled successfully`);
            }
            catch (error) {
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
            }
            catch (error) {
                console.warn(`Error cleaning up stream resources for ${requestId}:`, error);
            }
        }
        // Remove from tracking maps
        this.activeRequests.delete(requestId);
        this.activeStreams.delete(requestId);
    }
}
exports.OpenRouterAdapter = OpenRouterAdapter;
//# sourceMappingURL=openrouterAdapter.js.map