import { Conversation, ConversationMessage, ConversationModel } from '../models/conversation';
export declare class ConversationService {
    /**
     * Create a new conversation
     */
    createConversation(conversationData: {
        user_id: string;
        title?: string;
        model?: string;
        persona_id?: string;
        id?: string;
        email?: string;
        name?: string;
    }): Promise<Conversation>;
    /**
     * Get conversation by ID
     */
    getConversation(id: string): Promise<Conversation | null>;
    /**
     * Get user's conversations
     */
    getUserConversations(userId: string): Promise<Conversation[]>;
    /**
     * Update conversation
     */
    updateConversation(id: string, updateData: Partial<Omit<Conversation, 'id' | 'user_id' | 'created_at'>>): Promise<Conversation>;
    /**
     * Delete conversation
     */
    deleteConversation(id: string): Promise<void>;
    deleteAllConversations(userId: string): Promise<void>;
    /**
     * Sync conversation metadata from client
     */
    syncConversationMetadata(conversationId: string, metadata: {
        title: string;
        messageCount: number;
        lastMessageAt: Date;
    }): Promise<void>;
    /**
     * Add message to conversation (minimal server-side storage)
     */
    addMessage(messageData: Omit<ConversationMessage, 'id' | 'created_at'>): Promise<ConversationMessage>;
    /**
     * Get conversation messages
     */
    getConversationMessages(conversationId: string): Promise<ConversationMessage[]>;
    /**
     * Get message count for conversation
     */
    getMessageCount(conversationId: string): Promise<number>;
    /**
     * Switch model for conversation
     */
    switchModel(conversationId: string, modelId: string, reason?: string): Promise<ConversationModel>;
    /**
     * Get current model for conversation (latest from model history or conversation model field)
     */
    getCurrentModel(conversationId: string): Promise<string>;
    /**
     * Get conversation model history
     */
    getConversationModelHistory(conversationId: string): Promise<ConversationModel[]>;
    /**
     * Search conversations
     */
    searchConversations(userId: string, query: string): Promise<Conversation[]>;
    /**
     * Internal helper: ensure a User row exists for the given id.
     * Prevents FK violations when creating conversations for first-time authenticated users.
     */
    private ensureUserExists;
}
export declare const conversationService: ConversationService;
//# sourceMappingURL=conversationService.d.ts.map