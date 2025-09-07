import { getSupabase } from './db';
import { SharedConversation } from '../models/team';
import { conversationService } from './conversationService';
import { ConversationMessage } from '../models/conversation';

export class CollaborationService {
  /**
   * Share conversation with user
   */
  async shareConversation(conversationId: string, sharedWithId: string, sharedById: string, permission: string = 'read'): Promise<SharedConversation> {
    const supabase = getSupabase();
    
    const sharedConversation: SharedConversation = {
      id: this.generateId(),
      conversation_id: conversationId,
      shared_with_id: sharedWithId,
      shared_by_id: sharedById,
      permission,
      shared_at: new Date(),
      is_active: true
    };

    const { data, error } = await supabase
      .from('shared_conversations')
      .upsert(sharedConversation, { onConflict: 'conversation_id,shared_with_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to share conversation: ${error.message}`);
    }

    return data;
  }

  /**
   * Get shared conversations for user
   */
  async getSharedConversations(userId: string): Promise<SharedConversation[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('shared_conversations')
      .select(`
        *,
        conversation:conversations(title, updated_at, message_count)
      `)
      .eq('shared_with_id', userId)
      .eq('is_active', true)
      .order('shared_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch shared conversations: ${error.message}`);
    }

    return data;
  }

  /**
   * Get users that conversation is shared with
   */
  async getConversationShares(conversationId: string): Promise<SharedConversation[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('shared_conversations')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('is_active', true);

    if (error) {
      throw new Error(`Failed to fetch conversation shares: ${error.message}`);
    }

    return data;
  }

  /**
   * Update share permission
   */
  async updateSharePermission(conversationId: string, sharedWithId: string, permission: string): Promise<SharedConversation> {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('shared_conversations')
      .update({ permission })
      .eq('conversation_id', conversationId)
      .eq('shared_with_id', sharedWithId)
      .eq('is_active', true)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update share permission: ${error.message}`);
    }

    return data;
  }

  /**
   * Remove share
   */
  async removeShare(conversationId: string, sharedWithId: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('shared_conversations')
      .update({ is_active: false })
      .eq('conversation_id', conversationId)
      .eq('shared_with_id', sharedWithId);

    if (error) {
      throw new Error(`Failed to remove share: ${error.message}`);
    }
  }

  /**
   * Check if user has access to conversation
   */
  async hasAccessToConversation(conversationId: string, userId: string): Promise<boolean> {
    // Check if user owns the conversation
    const conversation = await conversationService.getConversation(conversationId);
    if (conversation && conversation.user_id === userId) {
      return true;
    }

    // Check if conversation is shared with user
    const supabase = getSupabase();
    const { data } = await supabase
      .from('shared_conversations')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('shared_with_id', userId)
      .eq('is_active', true)
      .single();

    return !!data;
  }

  /**
   * Add message to shared conversation (for real-time collaboration)
   */
  async addCollaborativeMessage(conversationId: string, messageData: any): Promise<ConversationMessage> {
    // Add the message to the conversation
    const message = await conversationService.addMessage(messageData);
    return message;
  }

  /**
   * Get conversation participants
   */
  async getConversationParticipants(conversationId: string): Promise<{user_id: string, permission: string}[]> {
    const supabase = getSupabase();
    
    // Get conversation owner
    const conversation = await conversationService.getConversation(conversationId);
    if (!conversation) {
      return [];
    }

    // Get shared users
    const { data: sharedUsers, error } = await supabase
      .from('shared_conversations')
      .select('shared_with_id, permission')
      .eq('conversation_id', conversationId)
      .eq('is_active', true);

    if (error) {
      throw new Error(`Failed to fetch shared users: ${error.message}`);
    }

    // Combine owner and shared users
    const participants = [
      { user_id: conversation.user_id, permission: 'owner' },
      ...sharedUsers.map(user => ({ 
        user_id: user.shared_with_id, 
        permission: user.permission 
      }))
    ];

    return participants;
  }

  /**
   * Get user's collaborative activity
   */
  async getUserCollaborativeActivity(userId: string, limit: number = 50): Promise<any[]> {
    const supabase = getSupabase();
    
    // Get conversations shared with user
    const { data: sharedConversations, error: sharedError } = await supabase
      .from('shared_conversations')
      .select('conversation_id, shared_at, permission')
      .eq('shared_with_id', userId)
      .eq('is_active', true)
      .order('shared_at', { ascending: false })
      .limit(limit);

    if (sharedError) {
      throw new Error(`Failed to fetch shared conversations: ${sharedError.message}`);
    }

    // Get recent messages from shared conversations
    const conversationIds = sharedConversations.map(sc => sc.conversation_id);
    if (conversationIds.length === 0) return [];

    const { data: messages, error: messagesError } = await supabase
      .from('conversation_messages')
      .select(`
        *,
        conversation:conversations(title)
      `)
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false })
      .limit(limit * 2); // Get more messages to account for filtering

    if (messagesError) {
      throw new Error(`Failed to fetch messages: ${messagesError.message}`);
    }

    return messages;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

// Export singleton instance
export const collaborationService = new CollaborationService();