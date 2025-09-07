import { AIModel } from '../models/conversation';
export declare class ModelManager {
    private availableModels;
    constructor();
    /**
     * Initialize available models
     */
    private initializeModels;
    /**
     * Get all available models
     */
    getAvailableModels(): Promise<AIModel[]>;
    /**
     * Get model by ID
     */
    getModelById(id: string): Promise<AIModel | undefined>;
    /**
     * Instant model switching (T3 Chat feature)
     */
    switchModel(conversationId: string, newModelId: string): Promise<AIModel>;
    /**
     * Automatic fallback for unavailable models
     */
    getFallbackModel(preferredModelId: string): Promise<AIModel>;
    /**
     * Check model availability
     */
    checkModelAvailability(modelId: string): Promise<boolean>;
    /**
     * Get models by capability
     */
    getModelsByCapability(capability: string): Promise<AIModel[]>;
}
export declare const modelManager: ModelManager;
//# sourceMappingURL=modelService.d.ts.map