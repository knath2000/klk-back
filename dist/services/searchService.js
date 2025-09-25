"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchService = exports.SearchService = void 0;
const client_1 = require("@prisma/client");
class SearchService {
    constructor() {
        this.prisma = new client_1.PrismaClient();
    }
    /**
     * Search conversations by title and content
     */
    async searchConversations(userId, query) {
        const conversations = await this.prisma.conversation.findMany({
            where: {
                user_id: userId,
                OR: [
                    { title: { contains: query, mode: 'insensitive' } },
                    {
                        messages: {
                            some: { content: { contains: query, mode: 'insensitive' } }
                        }
                    }
                ]
            },
            orderBy: { updated_at: 'desc' },
            take: 50
        });
        return conversations;
    }
    /**
     * Search conversation messages
     */
    async searchConversationMessages(userId, query) {
        // Find messages matching content
        const messages = await this.prisma.conversationMessage.findMany({
            where: { content: { contains: query, mode: 'insensitive' } },
            orderBy: { created_at: 'desc' },
            take: 50,
            include: {
                conversation: {
                    select: { id: true, user_id: true, title: true }
                }
            }
        });
        // Filter by access (owner) since we don't join team permissions here
        const filtered = messages.filter((m) => m.conversation?.user_id === userId);
        return filtered.map((m) => ({
            id: m.id,
            conversation_id: m.conversation_id,
            content: m.content,
            created_at: m.created_at.toISOString(),
            conversation_title: m.conversation?.title ?? 'Untitled Conversation'
        }));
    }
    /**
     * Get recent conversations for user
     */
    async getRecentConversations(userId, limit = 10) {
        const conversations = await this.prisma.conversation.findMany({
            where: { user_id: userId },
            orderBy: { updated_at: 'desc' },
            take: limit
        });
        return conversations;
    }
    /**
     * Get conversation suggestions based on query
     */
    async getSuggestions(userId, query) {
        const conversations = await this.prisma.conversation.findMany({
            where: {
                user_id: userId,
                title: { contains: query, mode: 'insensitive' }
            },
            select: { title: true },
            orderBy: { updated_at: 'desc' },
            take: 5
        });
        const titles = (conversations || []).map((c) => String(c.title));
        // Add common search terms based on user's conversation history
        const commonTerms = ['chat', 'discussion', 'meeting', 'project', 'idea', 'question'];
        const suggestions = [...new Set([...titles, ...commonTerms])];
        return suggestions.slice(0, 10);
    }
}
exports.SearchService = SearchService;
// Export singleton instance
exports.searchService = new SearchService();
//# sourceMappingURL=searchService.js.map