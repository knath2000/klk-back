import { Conversation, ConversationMessage, ConversationModel } from '../models/conversation';
import { PrismaClient } from '@prisma/client';

// Initialize Prisma
const prisma = new PrismaClient();

export class ConversationService {
  /**
   * Create a new conversation
   */
  async createConversation(conversationData: { user_id: string; title?: string; model?: string; persona_id?: string; id?: string; email?: string; name?: string }): Promise<Conversation> {
    const startTime = Date.now();
    console.log(`[ConversationService] createConversation started for user ${conversationData.user_id} at ${new Date(startTime).toISOString()}`);

    // Ensure the user exists to satisfy FK constraint (conversations_user_id_fkey)
    await this.ensureUserExists(conversationData.user_id, conversationData.email, conversationData.name);

    const created = await prisma.conversation.create({
      data: {
        // Use provided id or let Prisma generate with @default(uuid())
        id: conversationData.id,
        user_id: conversationData.user_id,
        title: conversationData.title || '',
        model: conversationData.model || process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it',
        persona_id: conversationData.persona_id ?? null,
        // Prisma handles created_at default; explicitly set updated_at
        updated_at: new Date(),
        message_count: 0,
        is_active: true
      }
    });
    console.log(`[ConversationService] createConversation completed for user ${conversationData.user_id}, id ${created.id} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

    // Map Prisma model to our interface shape (identical field names)
    return created as unknown as Conversation;
  }

  /**
   * Get conversation by ID
   */
  async getConversation(id: string): Promise<Conversation | null> {
    const startTime = Date.now();
    console.log(`[ConversationService] getConversation started for id ${id} at ${new Date(startTime).toISOString()}`);

    const conv = await prisma.conversation.findUnique({
      where: { id }
    });
    console.log(`[ConversationService] getConversation completed for id ${id} at ${new Date().toISOString()}, found: ${!!conv}, time: ${Date.now() - startTime}ms`);

    return conv as unknown as Conversation | null;
  }

  /**
   * Get user's conversations
   */
  async getUserConversations(userId: string): Promise<Conversation[]> {
    const startTime = Date.now();
    console.log(`[ConversationService] getUserConversations started for user ${userId} at ${new Date(startTime).toISOString()}`);

    const rows = await prisma.conversation.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' }
    });
    console.log(`[ConversationService] getUserConversations completed for user ${userId}, found ${rows.length} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

    return rows as unknown as Conversation[];
  }

  /**
   * Update conversation
   */
  async updateConversation(id: string, updateData: Partial<Omit<Conversation, 'id' | 'user_id' | 'created_at'>>): Promise<Conversation> {
    const startTime = Date.now();
    console.log(`[ConversationService] updateConversation started for id ${id} at ${new Date(startTime).toISOString()}`);

    const updateFields: any = { ...updateData };
    if (updateFields.updated_at === undefined) {
      updateFields.updated_at = new Date();
    }
    const updated = await prisma.conversation.update({
      where: { id },
      data: updateFields
    });
    console.log(`[ConversationService] updateConversation completed for id ${id} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

    return updated as unknown as Conversation;
  }

  /**
   * Delete conversation
   */
  async deleteConversation(id: string): Promise<void> {
    const startTime = Date.now();
    console.log(`[ConversationService] deleteConversation started for id ${id} at ${new Date(startTime).toISOString()}`);

    try {
      // Delete dependent records first to satisfy FK constraints, then delete the conversation
      await prisma.$transaction(async (tx) => {
        // Remove messages
        await tx.conversationMessage.deleteMany({ where: { conversation_id: id } });
        // Remove model switches
        await tx.conversationModel.deleteMany({ where: { conversation_id: id } });
        // Remove shared conversation entries
        await tx.sharedConversation.deleteMany({ where: { conversation_id: id } });
        // Remove analytics row if exists
        await tx.conversationAnalytics.deleteMany({ where: { conversation_id: id } });

        // Finally delete the conversation row
        await tx.conversation.delete({ where: { id } });
      });

      console.log(`[ConversationService] deleteConversation completed for id ${id} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
    } catch (e: any) {
      console.error('[ConversationService] Error deleting conversation:', e?.message || e);
      // Re-throw so upstream handlers return 500 and the proxy surfaces the error
      throw e;
    }
  }

  // New: Delete all conversations and dependent data for a given userId
  async deleteAllConversations(userId: string): Promise<void> {
    const startTime = Date.now();
    console.log(`[ConversationService] deleteAllConversations started for user ${userId} at ${new Date(startTime).toISOString()}`);

    try {
      // Find all conversation IDs for the user
      const convs = await prisma.conversation.findMany({
        where: { user_id: userId },
        select: { id: true }
      });
      const ids = convs.map(c => c.id);

      if (ids.length === 0) {
        console.log(`[ConversationService] No conversations found for user ${userId}; nothing to delete.`);
        return;
      }

      // Perform deletions in a single transaction to ensure integrity
      await prisma.$transaction(async (tx) => {
        await tx.conversationMessage.deleteMany({ where: { conversation_id: { in: ids } } });
        await tx.conversationModel.deleteMany({ where: { conversation_id: { in: ids } } });
        await tx.sharedConversation.deleteMany({ where: { conversation_id: { in: ids } } });
        await tx.conversationAnalytics.deleteMany({ where: { conversation_id: { in: ids } } });
        // Finally delete the conversations themselves
        await tx.conversation.deleteMany({ where: { id: { in: ids } } });
      });

      console.log(`[ConversationService] deleteAllConversations completed for user ${userId} at ${new Date().toISOString()}, deleted ${ids.length} conversations, time: ${Date.now() - startTime}ms`);
    } catch (e: any) {
      console.error('[ConversationService] Error deleting all conversations for user:', userId, e?.message || e);
      // Re-throw so callers can surface errors
      throw e;
    }
  }

  /**
   * Sync conversation metadata from client
   */
  async syncConversationMetadata(conversationId: string, metadata: { title: string; messageCount: number; lastMessageAt: Date }): Promise<void> {
    const startTime = Date.now();
    console.log(`[ConversationService] syncConversationMetadata started for id ${conversationId} at ${new Date(startTime).toISOString()}`);

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        title: metadata.title,
        message_count: metadata.messageCount,
        updated_at: metadata.lastMessageAt
      }
    });
    console.log(`[ConversationService] syncConversationMetadata completed for id ${conversationId} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
  }

  /**
   * Add message to conversation (minimal server-side storage)
   */
  async addMessage(messageData: Omit<ConversationMessage, 'id' | 'created_at'>): Promise<ConversationMessage> {
    const startTime = Date.now();
    console.log(`[ConversationService] addMessage started for conversation ${messageData.conversation_id} at ${new Date(startTime).toISOString()}`);

    const now = new Date();
    // Create message and bump counts in a transaction
    const created = await prisma.$transaction(async (tx) => {
      const createdMsg = await tx.conversationMessage.create({
        data: {
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
    console.log(`[ConversationService] addMessage completed for conversation ${messageData.conversation_id} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

    return created as unknown as ConversationMessage;
  }

  /**
   * Get conversation messages
   */
  async getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
    const startTime = Date.now();
    console.log(`[ConversationService] getConversationMessages started for id ${conversationId} at ${new Date(startTime).toISOString()}`);

    const rows = await prisma.conversationMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' }
    });
    console.log(`[ConversationService] getConversationMessages completed for id ${conversationId}, found ${rows.length} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

    return rows as unknown as ConversationMessage[];
  }

  /**
   * Get message count for conversation
   */
  async getMessageCount(conversationId: string): Promise<number> {
    const startTime = Date.now();
    console.log(`[ConversationService] getMessageCount started for id ${conversationId} at ${new Date(startTime).toISOString()}`);

    const count = await prisma.conversationMessage.count({
      where: { conversation_id: conversationId }
    });
    console.log(`[ConversationService] getMessageCount completed for id ${conversationId}, count ${count} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

    return count || 0;
  }

  /**
   * Switch model for conversation
   */
  async switchModel(conversationId: string, modelId: string, reason: string = 'user_choice'): Promise<ConversationModel> {
    const startTime = Date.now();
    console.log(`[ConversationService] switchModel started for conversation ${conversationId} at ${new Date(startTime).toISOString()}`);

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
      console.log(`[ConversationService] switchModel completed for conversation ${conversationId} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

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
    const startTime = Date.now();
    console.log(`[ConversationService] getCurrentModel started for id ${conversationId} at ${new Date(startTime).toISOString()}`);

    try {
      // Latest model switch takes precedence
      const latest = await prisma.conversationModel.findFirst({
        where: { conversation_id: conversationId },
        orderBy: { switched_at: 'desc' },
        select: { model_id: true }
      });
      if (latest?.model_id) {
        console.log(`[ConversationService] getCurrentModel found latest switch ${latest.model_id} for id ${conversationId} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
        return latest.model_id;
      }

      // Fallback to conversation's current model
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { model: true }
      });
      if (conv?.model) {
        console.log(`[ConversationService] getCurrentModel found conversation model ${conv.model} for id ${conversationId} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
        return conv.model;
      }
    } catch (e: any) {
      console.warn(
        '[conversationService.getCurrentModel] DB unavailable; using default model.',
        e?.message || e
      );
    }

    const defaultModel = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it';
    console.log(`[ConversationService] getCurrentModel fallback to default ${defaultModel} for id ${conversationId} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

    // Final fallback to default
    return defaultModel;
  }

  /**
   * Get conversation model history
   */
  async getConversationModelHistory(conversationId: string): Promise<ConversationModel[]> {
    const startTime = Date.now();
    console.log(`[ConversationService] getConversationModelHistory started for id ${conversationId} at ${new Date(startTime).toISOString()}`);

    const rows = await prisma.conversationModel.findMany({
      where: { conversation_id: conversationId },
      orderBy: { switched_at: 'desc' }
    });
    console.log(`[ConversationService] getConversationModelHistory completed for id ${conversationId}, found ${rows.length} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

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
    const startTime = Date.now();
    console.log(`[ConversationService] searchConversations started for user ${userId} query "${query}" at ${new Date(startTime).toISOString()}`);

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
    console.log(`[ConversationService] searchConversations completed for user ${userId}, found ${rows.length} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);

    return rows as unknown as Conversation[];
  }

  /**
   * Internal helper: ensure a User row exists for the given id.
   * Prevents FK violations when creating conversations for first-time authenticated users.
   */
  private async ensureUserExists(userId: string, email?: string, name?: string): Promise<void> {
    try {
      // Build a deterministic, unique, and non-null fallback email to satisfy DB NOT NULL + UNIQUE(email)
      const fallbackEmail = email && email.trim().length > 0
        ? email
        : `stack-${userId}@users.local`;
      await prisma.user.upsert({
        where: { id: userId },
        update: {
          updated_at: new Date(),
          // Always ensure email is non-null on update for NOT NULL column safety
          email: fallbackEmail,
          ...(name ? { name } : {}),
        },
        create: {
          id: userId,
          email: fallbackEmail,
          ...(name ? { name } : {}),
        }
      });
    } catch (e: any) {
      console.warn('[ConversationService] ensureUserExists failed:', e?.message || e);
    }
  }
}

// Export singleton instance
export const conversationService = new ConversationService();