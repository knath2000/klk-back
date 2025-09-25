import { PrismaClient } from '@prisma/client';
import { SharedConversation } from '../models/team';
import { conversationService } from './conversationService';
import { ConversationMessage } from '../models/conversation';

// Add interfaces after imports
interface SharedUser {
  shared_with_id: string;
  permission: string;
}

// Narrow row type for partial select in getUserCollaborativeActivity
interface SharedConversationRow {
  conversation_id: string;
  shared_at: string | Date;
  permission: string;
}

export class CollaborationService {
  private prisma = new PrismaClient();

  /**
   * Share conversation with user
   */
  async shareConversation(conversationId: string, sharedWithId: string, sharedById: string, permission: string = 'read'): Promise<SharedConversation> {
    const now = new Date();
    const row = await this.prisma.sharedConversation.upsert({
      where: {
        conversation_id_shared_with_id: {
          conversation_id: conversationId,
          shared_with_id: sharedWithId
        }
      },
      update: { permission, shared_by_id: sharedById, shared_at: now, is_active: true },
      create: {
        conversation_id: conversationId,
        shared_with_id: sharedWithId,
        shared_by_id: sharedById,
        permission,
        shared_at: now,
        is_active: true
      }
    });
    return row as unknown as SharedConversation;
  }

  /**
   * Get shared conversations for user
   */
  async getSharedConversations(userId: string): Promise<SharedConversation[]> {
    const rows = await this.prisma.sharedConversation.findMany({
      where: { shared_with_id: userId, is_active: true },
      orderBy: { shared_at: 'desc' },
      include: {
        conversation: {
          select: { title: true, updated_at: true, message_count: true }
        }
      }
    });
    return rows as unknown as SharedConversation[];
  }

  /**
   * Get users that conversation is shared with
   */
  async getConversationShares(conversationId: string): Promise<SharedConversation[]> {
    const rows = await this.prisma.sharedConversation.findMany({
      where: { conversation_id: conversationId, is_active: true }
    });
    return rows as unknown as SharedConversation[];
  }

  /**
   * Update share permission
   */
  async updateSharePermission(conversationId: string, sharedWithId: string, permission: string): Promise<SharedConversation> {
    const updated = await this.prisma.sharedConversation.update({
      where: {
        conversation_id_shared_with_id: {
          conversation_id: conversationId,
          shared_with_id: sharedWithId
        }
      },
      data: { permission }
    });
    return updated as unknown as SharedConversation;
  }

  /**
   * Remove share
   */
  async removeShare(conversationId: string, sharedWithId: string): Promise<void> {
    await this.prisma.sharedConversation.update({
      where: {
        conversation_id_shared_with_id: {
          conversation_id: conversationId,
          shared_with_id: sharedWithId
        }
      },
      data: { is_active: false }
    });
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
    const row = await this.prisma.sharedConversation.findUnique({
      where: {
        conversation_id_shared_with_id: {
          conversation_id: conversationId,
          shared_with_id: userId
        }
      },
      select: { id: true, is_active: true }
    });
    return !!row && !!row.is_active;
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
    // Get conversation owner
    const conversation = await conversationService.getConversation(conversationId);
    if (!conversation) {
      return [];
    }

    // Get shared users
    const sharedUsers = await this.prisma.sharedConversation.findMany({
      where: { conversation_id: conversationId, is_active: true },
      select: { shared_with_id: true, permission: true }
    });

    // Combine owner and shared users
    const participants = [
      { user_id: conversation.user_id, permission: 'owner' },
      ...sharedUsers.map((user: SharedUser) => ({ 
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
    const sharedRows = await this.prisma.sharedConversation.findMany({
      where: { shared_with_id: userId, is_active: true },
      select: { conversation_id: true, shared_at: true, permission: true },
      orderBy: { shared_at: 'desc' },
      take: limit
    });

    // Get recent messages from shared conversations
    const conversationIds = sharedRows.map((sc: SharedConversationRow) => sc.conversation_id);
    if (conversationIds.length === 0) return [];

    const messages = await this.prisma.conversationMessage.findMany({
      where: { conversation_id: { in: conversationIds } },
      orderBy: { created_at: 'desc' },
      take: limit * 2,
      include: { conversation: { select: { title: true } } }
    });
    return messages.map((m) => ({
      id: m.id,
      conversation_id: m.conversation_id,
      content: m.content,
      created_at: m.created_at,
      conversation_title: (m as any).conversation?.title ?? 'Untitled Conversation'
    }));
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