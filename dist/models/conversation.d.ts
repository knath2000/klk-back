export interface Conversation {
    id: string;
    user_id: string;
    title: string;
    model: string;
    persona_id?: string;
    created_at: Date;
    updated_at: Date;
    message_count: number;
    is_active: boolean;
}
export interface ConversationMessage {
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    model: string;
    persona_id?: string;
    tokens_used?: number;
    created_at: Date;
}
export interface ConversationModel {
    conversation_id: string;
    model_id: string;
    switched_at: Date;
    reason?: string;
}
export interface AIModel {
    id: string;
    name: string;
    provider: 'openrouter' | 'anthropic' | 'openai' | 'google';
    model_id: string;
    display_name: string;
    description: string;
    context_window: number;
    pricing_per_token: number;
    is_available: boolean;
    capabilities: string[];
    inference_speed: 'fast' | 'medium' | 'slow';
}
export interface SubscriptionPlan {
    id: string;
    name: string;
    description: string;
    price_monthly: number;
    price_yearly: number;
    features: string[];
    limits: {
        conversations_per_month: number;
        messages_per_conversation: number;
        models_access: string[];
        storage_gb: number;
    };
}
//# sourceMappingURL=conversation.d.ts.map