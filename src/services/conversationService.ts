import { Conversation, ConversationMessage, ConversationModel } from '../models/conversation';
import { PrismaClient } from '@prisma/client';

// Initialize Prisma
const prisma = new PrismaClient();

export class ConversationService {
  /**
   * Create a new conversation
   */
  async createConversation(conversationData: Omit<Conversation, 'created_at' | 'updated_at' | 'message_count' | 'is_active'>): Promise<Conversation> {
    const created = await prisma.conversation.create({
      data: {
        // Preserve client-provided id if present (existing API expects this)
        id: (conversationData as any).id,
        user_id: conversationData.user_id,
        title: conversationData.title,
        model: conversationData.model,
        persona_id: conversationData.persona_id ?? null,
        // Prisma handles created_at default; we still explicitly set updated_at now()
        updated_at: new Date(),
        message_count: 0,
        is_active: true
      }
    });
    // Map Prisma model to our interface shape (identical field names)
    return created as unknown as Conversation;
  }

  /**
   * Get conversation by ID
   */
  async getConversation(id: string): Promise<Conversation | null> {
    const conv = await prisma.conversation.findUnique({
      where: { id }
    });
    return conv as unknown as Conversation | null;
  }

  /**
   * Get user's conversations
   */
  async getUserConversations(userId: string): Promise<Conversation[]> {
    const rows = await prisma.conversation.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' }
    });
    return rows as unknown as Conversation[];
  }

  /**
   * Update conversation
   */
  async updateConversation(id: string, updateData: Partial<Omit<Conversation, 'id' | 'user_id' | 'created_at'>>): Promise<Conversation> {
    const updateFields: any = { ...updateData };
    if (updateFields.updated_at === undefined) {
      updateFields.updated_at = new Date();
    }
    const updated = await prisma.conversation.update({
      where: { id },
      data: updateFields
    });
    return updated as unknown as Conversation;
  }

  /**
   * Delete conversation
   */
  async deleteConversation(id: string): Promise<void> {
    await prisma.conversation.delete({ where: { id } });
  }

  /**
   * Sync conversation metadata from client
   */
  async syncConversationMetadata(conversationId: string, metadata: { title: string; messageCount: number; lastMessageAt: Date }): Promise<void> {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        title: metadata.title,
        message_count: metadata.messageCount,
        updated_at: metadata.lastMessageAt
      }
    });
  }

  /**
   * Add message to conversation (minimal server-side storage)
   */
  async addMessage(messageData: Omit<ConversationMessage, 'id' | 'created_at'>): Promise<ConversationMessage> {
    const messageId = this.generateId();
    const now = new Date();
    // Create message and bump counts in a transaction
    const created = await prisma.$transaction(async (tx) => {
      const createdMsg = await tx.conversationMessage.create({
        data: {
          id: messageId,
          conversation_id: messageData.conversation_id,
          role: messageData.role,
          content: messageData.content,
          model: messageData.model,
          persona_id: messageData.persona_id ?? null,
          tokens_used: messageData.tokens_used ?? null,
          created_at: now
        }
      });
      const currentCount = await tx.conversationMessage.count({
        where: { conversation_id: messageData.conversation_id }
      });
      await tx.conversation.update({
        where: { id: messageData.conversation_id },
        data: { message_count: currentCount, updated_at: now }
      });
      return createdMsg;
    });
    return created as unknown as ConversationMessage;
  }

  /**
   * Get conversation messages
   */
  async getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
    const rows = await prisma.conversationMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' }
    });
    return rows as unknown as ConversationMessage[];
  }

  /**
   * Get message count for conversation
   */
  async getMessageCount(conversationId: string): Promise<number> {
    const count = await prisma.conversationMessage.count({
      where: { conversation_id: conversationId }
    });
    return count || 0;
  }

  /**
   * Switch model for conversation
   */
  async switchModel(conversationId: string, modelId: string, reason: string = 'user_choice'): Promise<ConversationModel> {
    // Always construct a result we can return even if persistence is unavailable
    const modelSwitch: ConversationModel = {
      conversation_id: conversationId,
      model_id: modelId,
      switched_at: new Date(),
      reason
    };

    try {
      const created = await prisma.$transaction(async (tx) => {
        const createdSwitch = await tx.conversationModel.create({
          data: {
            conversation_id: conversationId,
            model_id: modelId,
            switched_at: modelSwitch.switched_at,
            reason
          }
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { model: modelId }
        });
        return createdSwitch;
      });
      // Map to interface
      return {
        conversation_id: created.conversation_id,
        model_id: created.model_id,
        switched_at: created.switched_at,
        reason: created.reason ?? undefined
      };
    } catch (e: any) {
      // Graceful degradation: if Supabase is not configured or errors, skip persistence
      console.warn(
        '[conversationService.switchModel] DB unavailable; skipping persistence. Returning transient switch result.',
        e?.message || e
      );
      return modelSwitch;
    }
  }

  /**
   * Get current model for conversation (latest from model history or conversation model field)
   */
  async getCurrentModel(conversationId: string): Promise<string> {
    try {
      // Latest model switch takes precedence
      const latest = await prisma.conversationModel.findFirst({
        where: { conversation_id: conversationId },
        orderBy: { switched_at: 'desc' },
        select: { model_id: true }
      });
      if (latest?.model_id) return latest.model_id;

      // Fallback to conversation's current model
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { model: true }
      });
      if (conv?.model) return conv.model;
    } catch (e: any) {
      console.warn(
        '[conversationService.getCurrentModel] DB unavailable; using default model.',
        e?.message || e
      );
    }

    // Final fallback to default
    return process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
  }

  /**
   * Get conversation model history
   */
  async getConversationModelHistory(conversationId: string): Promise<ConversationModel[]> {
    const rows = await prisma.conversationModel.findMany({
      where: { conversation_id: conversationId },
      orderBy: { switched_at: 'desc' }
    });
    return rows.map((r) => ({
      conversation_id: r.conversation_id,
      model_id: r.model_id,
      switched_at: r.switched_at,
      reason: r.reason ?? undefined
    }));
  }

  /**
   * Search conversations
   */
  async searchConversations(userId: string, query: string): Promise<Conversation[]> {
    const rows = await prisma.conversation.findMany({
      where: {
        user_id: userId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          {
            messages: {
              some: {
                content: { contains: query, mode: 'insensitive' }
              }
            }
          }
        ]
      },
      orderBy: { updated_at: 'desc' }
    });
    return rows as unknown as Conversation[];
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

// Export singleton instance
export const conversationService = new ConversationService();