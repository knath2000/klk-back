import { getSupabase } from './db';
import { Conversation } from '../models/conversation';

export class SearchService {
  /**
   * Search conversations by title and content
   */
  async searchConversations(userId: string, query: string): Promise<Conversation[]> {
    const supabase = getSupabase();
    
    // Search conversation titles and metadata
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        id,
        user_id,
        title,
        model,
        persona_id,
        created_at,
        updated_at,
        message_count,
        is_active
      `)
      .eq('user_id', userId)
      .ilike('title', `%${query}%`)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Search error:', error);
      return [];
    }

    return conversations;
  }

  /**
   * Search conversation messages
   */
  async searchConversationMessages(userId: string, query: string): Promise<any[]> {
    const supabase = getSupabase();
    
    // Search through conversation messages
    const { data: messages, error } = await supabase
      .from('conversation_messages')
      .select(`
        id,
        conversation_id,
        content,
        created_at
      `)
      .ilike('content', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Message search error:', error);
      return [];
    }

    // Get conversation titles for context
    if (messages.length > 0) {
      const conversationIds = [...new Set(messages.map(m => m.conversation_id))];
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id, title')
        .in('id', conversationIds);

      const conversationMap = new Map(conversations?.map(c => [c.id, c.title]) || []);

      return messages.map(message => ({
        ...message,
        conversation_title: conversationMap.get(message.conversation_id) || 'Untitled Conversation'
      }));
    }

    return messages;
  }

  /**
   * Get recent conversations for user
   */
  async getRecentConversations(userId: string, limit: number = 10): Promise<Conversation[]> {
    const supabase = getSupabase();
    
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        id,
        user_id,
        title,
        model,
        persona_id,
        created_at,
        updated_at,
        message_count,
        is_active
      `)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Recent conversations error:', error);
      return [];
    }

    return conversations;
  }

  /**
   * Get conversation suggestions based on query
   */
  async getSuggestions(userId: string, query: string): Promise<string[]> {
    const supabase = getSupabase();
    
    // Get recent conversation titles for suggestions
    const { data: conversations } = await supabase
      .from('conversations')
      .select('title')
      .eq('user_id', userId)
      .ilike('title', `%${query}%`)
      .order('updated_at', { ascending: false })
      .limit(5);

    const titles = conversations?.map(c => c.title) || [];
    
    // Add common search terms based on user's conversation history
    const commonTerms = ['chat', 'discussion', 'meeting', 'project', 'idea', 'question'];
    const suggestions = [...new Set([...titles, ...commonTerms])];
    
    return suggestions.slice(0, 10);
  }
}

// Export singleton instance
export const searchService = new SearchService();