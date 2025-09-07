"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelManager = exports.ModelManager = void 0;
class ModelManager {
    constructor() {
        this.availableModels = [];
        this.initializeModels();
    }
    /**
     * Initialize available models
     */
    initializeModels() {
        // Default models - in production, these would be loaded from database
        this.availableModels = [
            {
                id: 'gpt-4o',
                name: 'GPT-4o',
                provider: 'openai',
                model_id: 'gpt-4o',
                display_name: 'GPT-4o',
                description: 'OpenAI\'s most advanced model',
                context_window: 128000,
                pricing_per_token: 0.000005,
                is_available: true,
                capabilities: ['text', 'vision', 'reasoning'],
                inference_speed: 'fast'
            },
            {
                id: 'claude-3-5-sonnet',
                name: 'Claude 3.5 Sonnet',
                provider: 'anthropic',
                model_id: 'claude-3-5-sonnet-20240620',
                display_name: 'Claude 3.5 Sonnet',
                description: 'Anthropic\'s most intelligent model',
                context_window: 200000,
                pricing_per_token: 0.000015,
                is_available: true,
                capabilities: ['text', 'vision', 'reasoning'],
                inference_speed: 'medium'
            },
            {
                id: 'gemini-pro',
                name: 'Gemini Pro',
                provider: 'google',
                model_id: 'gemini-pro',
                display_name: 'Gemini Pro',
                description: 'Google\'s advanced multimodal model',
                context_window: 32768,
                pricing_per_token: 0.0000005,
                is_available: true,
                capabilities: ['text', 'vision', 'reasoning'],
                inference_speed: 'fast'
            },
            {
                id: 'gpt-4o-mini',
                name: 'GPT-4o Mini',
                provider: 'openai',
                model_id: 'gpt-4o-mini',
                display_name: 'GPT-4o Mini',
                description: 'OpenAI\'s fast and affordable model',
                context_window: 128000,
                pricing_per_token: 0.00000015,
                is_available: true,
                capabilities: ['text', 'reasoning'],
                inference_speed: 'fast'
            }
        ];
    }
    /**
     * Get all available models
     */
    async getAvailableModels() {
        return this.availableModels;
    }
    /**
     * Get model by ID
     */
    async getModelById(id) {
        return this.availableModels.find(model => model.id === id);
    }
    /**
     * Instant model switching (T3 Chat feature)
     */
    async switchModel(conversationId, newModelId) {
        const newModel = this.availableModels.find(m => m.id === newModelId);
        if (!newModel) {
            throw new Error('Model not found');
        }
        // In a real implementation, this would update the database
        // For now, we'll just log the switch
        console.log(`Model switched for conversation ${conversationId} to ${newModel.display_name}`);
        return newModel;
    }
    /**
     * Automatic fallback for unavailable models
     */
    async getFallbackModel(preferredModelId) {
        const preferred = this.availableModels.find(m => m.id === preferredModelId);
        if (preferred?.is_available)
            return preferred;
        // Find fastest available alternative
        return this.availableModels
            .filter(m => m.is_available)
            .sort((a, b) => {
            const speedOrder = { fast: 0, medium: 1, slow: 2 };
            return speedOrder[a.inference_speed] - speedOrder[b.inference_speed];
        })[0] || this.availableModels[0];
    }
    /**
     * Check model availability
     */
    async checkModelAvailability(modelId) {
        const model = this.availableModels.find(m => m.id === modelId);
        return model?.is_available ?? false;
    }
    /**
     * Get models by capability
     */
    async getModelsByCapability(capability) {
        return this.availableModels.filter(model => model.is_available && model.capabilities.includes(capability));
    }
}
exports.ModelManager = ModelManager;
// Export singleton instance
exports.modelManager = new ModelManager();
//# sourceMappingURL=modelService.js.map