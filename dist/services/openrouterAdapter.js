"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterAdapter = void 0;
const node_fetch_1 = __importStar(require("node-fetch"));
const llmAdapter_1 = require("./llmAdapter");
class OpenRouterAdapter extends llmAdapter_1.BaseLLMAdapter {
    constructor() {
        super(...arguments);
        this.activeRequests = new Map();
    }
    async *streamCompletion(messages, options) {
        const controller = new AbortController();
        const requestId = options.requestId || `req_${Date.now()}`;
        this.activeRequests.set(requestId, controller);
        try {
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}/chat/completions`, {
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
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
            }
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('Response body is not readable');
            }
            const decoder = new TextDecoder();
            let buffer = '';
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
                reader.releaseLock();
            }
        }
        catch (error) {
            if (error instanceof node_fetch_1.AbortError) {
                console.log(`Request ${requestId} was cancelled`);
            }
            else {
                console.error('Streaming error:', error);
                throw error;
            }
        }
        finally {
            this.activeRequests.delete(requestId);
        }
        // generator completes without returning a value
    }
    async fetchCompletion(messages, options) {
        const controller = new AbortController();
        const requestId = options.requestId || `req_${Date.now()}`;
        this.activeRequests.set(requestId, controller);
        try {
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}/chat/completions`, {
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
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
            }
            const data = await response.json();
            return data.choices?.[0]?.message?.content || '';
        }
        catch (error) {
            if (error instanceof node_fetch_1.AbortError) {
                console.log(`Request ${requestId} was cancelled`);
                return '';
            }
            else {
                console.error('Completion error:', error);
                // Return empty string on error to satisfy return type
                return '';
            }
        }
        finally {
            this.activeRequests.delete(requestId);
        }
    }
    async cancel(requestId) {
        const controller = this.activeRequests.get(requestId);
        if (controller) {
            controller.abort();
            this.activeRequests.delete(requestId);
        }
    }
}
exports.OpenRouterAdapter = OpenRouterAdapter;
//# sourceMappingURL=openrouterAdapter.js.map