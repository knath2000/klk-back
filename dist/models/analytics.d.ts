export interface ConversationAnalytics {
    id: string;
    conversation_id: string;
    user_id: string;
    message_count: number;
    token_usage: number;
    model_usage: Record<string, number>;
    duration_seconds: number;
    first_message_at: Date;
    last_message_at: Date;
    avg_response_time?: number;
    created_at: Date;
    updated_at: Date;
}
export interface UserAnalytics {
    id: string;
    user_id: string;
    total_conversations: number;
    total_messages: number;
    total_tokens: number;
    active_days: number;
    favorite_model?: string;
    favorite_persona?: string;
    last_active_at?: Date;
    created_at: Date;
    updated_at: Date;
}
export interface TeamAnalytics {
    id: string;
    team_id: string;
    total_conversations: number;
    total_messages: number;
    total_tokens: number;
    active_members: number;
    created_at: Date;
    updated_at: Date;
}
//# sourceMappingURL=analytics.d.ts.map