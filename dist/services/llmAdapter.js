"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseLLMAdapter = void 0;
class BaseLLMAdapter {
    constructor(apiKey, baseUrl, timeout = 30000) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.timeout = timeout;
    }
    isReady() {
        return !!(this.apiKey && this.baseUrl);
    }
}
exports.BaseLLMAdapter = BaseLLMAdapter;
//# sourceMappingURL=llmAdapter.js.map