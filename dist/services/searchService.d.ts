import { Conversation } from '../models/conversation';
export declare class SearchService {
    private prisma;
    /**
     * Search conversations by title and content
     */
    searchConversations(userId: string, query: string): Promise<Conversation[]>;
    /**
     * Search conversation messages
     */
    searchConversationMessages(userId: string, query: string): Promise<any[]>;
    /**
     * Get recent conversations for user
     */
    getRecentConversations(userId: string, limit?: number): Promise<Conversation[]>;
    /**
     * Get conversation suggestions based on query
     */
    getSuggestions(userId: string, query: string): Promise<string[]>;
}
export interface ConversationMessage {
    id: string;
    conversation_id: string;
    content: string;
    created_at: string;
}
export declare const searchService: SearchService;
//# sourceMappingURL=searchService.d.ts.map