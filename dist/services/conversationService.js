"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conversationService = exports.ConversationService = void 0;
const client_1 = require("@prisma/client");
// Initialize Prisma
const prisma = new client_1.PrismaClient();
class ConversationService {
    /**
     * Create a new conversation
     */
    async createConversation(conversationData) {
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
                model: conversationData.model || process.env.OPENROUTER_MODEL || 'gpt-4o-mini',
                persona_id: conversationData.persona_id ?? null,
                // Prisma handles created_at default; explicitly set updated_at
                updated_at: new Date(),
                message_count: 0,
                is_active: true
            }
        });
        console.log(`[ConversationService] createConversation completed for user ${conversationData.user_id}, id ${created.id} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
        // Map Prisma model to our interface shape (identical field names)
        return created;
    }
    /**
     * Get conversation by ID
     */
    async getConversation(id) {
        const startTime = Date.now();
        console.log(`[ConversationService] getConversation started for id ${id} at ${new Date(startTime).toISOString()}`);
        const conv = await prisma.conversation.findUnique({
            where: { id }
        });
        console.log(`[ConversationService] getConversation completed for id ${id} at ${new Date().toISOString()}, found: ${!!conv}, time: ${Date.now() - startTime}ms`);
        return conv;
    }
    /**
     * Get user's conversations
     */
    async getUserConversations(userId) {
        const startTime = Date.now();
        console.log(`[ConversationService] getUserConversations started for user ${userId} at ${new Date(startTime).toISOString()}`);
        const rows = await prisma.conversation.findMany({
            where: { user_id: userId },
            orderBy: { updated_at: 'desc' }
        });
        console.log(`[ConversationService] getUserConversations completed for user ${userId}, found ${rows.length} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
        return rows;
    }
    /**
     * Update conversation
     */
    async updateConversation(id, updateData) {
        const startTime = Date.now();
        console.log(`[ConversationService] updateConversation started for id ${id} at ${new Date(startTime).toISOString()}`);
        const updateFields = { ...updateData };
        if (updateFields.updated_at === undefined) {
            updateFields.updated_at = new Date();
        }
        const updated = await prisma.conversation.update({
            where: { id },
            data: updateFields
        });
        console.log(`[ConversationService] updateConversation completed for id ${id} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
        return updated;
    }
    /**
     * Delete conversation
     */
    async deleteConversation(id) {
        const startTime = Date.now();
        console.log(`[ConversationService] deleteConversation started for id ${id} at ${new Date(startTime).toISOString()}`);
        await prisma.conversation.delete({ where: { id } });
        console.log(`[ConversationService] deleteConversation completed for id ${id} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
    }
    /**
     * Sync conversation metadata from client
     */
    async syncConversationMetadata(conversationId, metadata) {
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
    async addMessage(messageData) {
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
        return created;
    }
    /**
     * Get conversation messages
     */
    async getConversationMessages(conversationId) {
        const startTime = Date.now();
        console.log(`[ConversationService] getConversationMessages started for id ${conversationId} at ${new Date(startTime).toISOString()}`);
        const rows = await prisma.conversationMessage.findMany({
            where: { conversation_id: conversationId },
            orderBy: { created_at: 'asc' }
        });
        console.log(`[ConversationService] getConversationMessages completed for id ${conversationId}, found ${rows.length} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
        return rows;
    }
    /**
     * Get message count for conversation
     */
    async getMessageCount(conversationId) {
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
    async switchModel(conversationId, modelId, reason = 'user_choice') {
        const startTime = Date.now();
        console.log(`[ConversationService] switchModel started for conversation ${conversationId} at ${new Date(startTime).toISOString()}`);
        // Always construct a result we can return even if persistence is unavailable
        const modelSwitch = {
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
        }
        catch (e) {
            // Graceful degradation: if Supabase is not configured or errors, skip persistence
            console.warn('[conversationService.switchModel] DB unavailable; skipping persistence. Returning transient switch result.', e?.message || e);
            return modelSwitch;
        }
    }
    /**
     * Get current model for conversation (latest from model history or conversation model field)
     */
    async getCurrentModel(conversationId) {
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
        }
        catch (e) {
            console.warn('[conversationService.getCurrentModel] DB unavailable; using default model.', e?.message || e);
        }
        const defaultModel = process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
        console.log(`[ConversationService] getCurrentModel fallback to default ${defaultModel} for id ${conversationId} at ${new Date().toISOString()}, time: ${Date.now() - startTime}ms`);
        // Final fallback to default
        return defaultModel;
    }
    /**
     * Get conversation model history
     */
    async getConversationModelHistory(conversationId) {
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
    async searchConversations(userId, query) {
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
        return rows;
    }
    /**
     * Internal helper: ensure a User row exists for the given id.
     * Prevents FK violations when creating conversations for first-time authenticated users.
     */
    async ensureUserExists(userId, email, name) {
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
        }
        catch (e) {
            console.warn('[ConversationService] ensureUserExists failed:', e?.message || e);
        }
    }
}
exports.ConversationService = ConversationService;
// Export singleton instance
exports.conversationService = new ConversationService();
//# sourceMappingURL=conversationService.js.map