import { Conversation } from '../models/conversation';
import { PrismaClient } from '@prisma/client';

export class SearchService {
  private prisma = new PrismaClient();
  /**
   * Search conversations by title and content
   */
  async searchConversations(userId: string, query: string): Promise<Conversation[]> {
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
    return conversations as unknown as Conversation[];
  }

  /**
   * Search conversation messages
   */
  async searchConversationMessages(userId: string, query: string): Promise<any[]> {
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
    const filtered = messages.filter((m) => (m as any).conversation?.user_id === userId);
    return filtered.map((m) => ({
      id: m.id,
      conversation_id: m.conversation_id,
      content: m.content,
      created_at: m.created_at.toISOString(),
      conversation_title: (m as any).conversation?.title ?? 'Untitled Conversation'
    }));
  }

  /**
   * Get recent conversations for user
   */
  async getRecentConversations(userId: string, limit: number = 10): Promise<Conversation[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
      take: limit
    });
    return conversations as unknown as Conversation[];
  }

  /**
   * Get conversation suggestions based on query
   */
  async getSuggestions(userId: string, query: string): Promise<string[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        user_id: userId,
        title: { contains: query, mode: 'insensitive' }
      },
      select: { title: true },
      orderBy: { updated_at: 'desc' },
      take: 5
    });
    const titles = (conversations || []).map((c) => String((c as any).title));
    // Add common search terms based on user's conversation history
    const commonTerms = ['chat', 'discussion', 'meeting', 'project', 'idea', 'question'];
    const suggestions = [...new Set([...titles, ...commonTerms])];
    
    return suggestions.slice(0, 10);
  }
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  content: string;
  created_at: string;
}

// Narrow types for partial selects
interface ConversationTitleRow {
  id: string;
  title: string;
}

// Export singleton instance
export const searchService = new SearchService();