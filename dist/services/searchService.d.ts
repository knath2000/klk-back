import { Conversation } from '../models/conversation';
export declare class SearchService {
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
export declare const searchService: SearchService;
//# sourceMappingURL=searchService.d.ts.map