"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conversationService = exports.ConversationService = void 0;
const db_1 = require("./db");
class ConversationService {
    /**
     * Create a new conversation
     */
    async createConversation(conversationData) {
        const supabase = (0, db_1.getSupabase)();
        const conversation = {
            ...conversationData,
            created_at: new Date(),
            updated_at: new Date(),
            message_count: 0,
            is_active: true
        };
        const { data, error } = await supabase
            .from('conversations')
            .insert([conversation])
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to create conversation: ${error.message}`);
        }
        return data;
    }
    /**
     * Get conversation by ID
     */
    async getConversation(id) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('conversations')
            .select('*')
            .eq('id', id)
            .single();
        if (error) {
            return null;
        }
        return data;
    }
    /**
     * Get user's conversations
     */
    async getUserConversations(userId) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('conversations')
            .select('*')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });
        if (error) {
            throw new Error(`Failed to fetch user conversations: ${error.message}`);
        }
        return data;
    }
    /**
     * Update conversation
     */
    async updateConversation(id, updateData) {
        const supabase = (0, db_1.getSupabase)();
        const updateFields = { ...updateData };
        if (updateData.updated_at === undefined) {
            updateFields.updated_at = new Date();
        }
        const { data, error } = await supabase
            .from('conversations')
            .update(updateFields)
            .eq('id', id)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to update conversation: ${error.message}`);
        }
        return data;
    }
    /**
     * Delete conversation
     */
    async deleteConversation(id) {
        const supabase = (0, db_1.getSupabase)();
        const { error } = await supabase
            .from('conversations')
            .delete()
            .eq('id', id);
        if (error) {
            throw new Error(`Failed to delete conversation: ${error.message}`);
        }
    }
    /**
     * Sync conversation metadata from client
     */
    async syncConversationMetadata(conversationId, metadata) {
        const supabase = (0, db_1.getSupabase)();
        const { error } = await supabase
            .from('conversations')
            .update({
            title: metadata.title,
            message_count: metadata.messageCount,
            updated_at: metadata.lastMessageAt
        })
            .eq('id', conversationId);
        if (error) {
            throw new Error(`Failed to sync conversation metadata: ${error.message}`);
        }
    }
    /**
     * Add message to conversation (minimal server-side storage)
     */
    async addMessage(messageData) {
        const supabase = (0, db_1.getSupabase)();
        const message = {
            id: this.generateId(),
            ...messageData,
            created_at: new Date()
        };
        const { data, error } = await supabase
            .from('conversation_messages')
            .insert([message])
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to add message: ${error.message}`);
        }
        // Update conversation message count
        await this.updateConversation(message.conversation_id, {
            message_count: (await this.getMessageCount(message.conversation_id)) + 1,
            updated_at: new Date()
        });
        return data;
    }
    /**
     * Get conversation messages
     */
    async getConversationMessages(conversationId) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('conversation_messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });
        if (error) {
            throw new Error(`Failed to fetch conversation messages: ${error.message}`);
        }
        return data;
    }
    /**
     * Get message count for conversation
     */
    async getMessageCount(conversationId) {
        const supabase = (0, db_1.getSupabase)();
        const { count, error } = await supabase
            .from('conversation_messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conversationId);
        if (error) {
            throw new Error(`Failed to get message count: ${error.message}`);
        }
        return count || 0;
    }
    /**
     * Switch model for conversation
     */
    async switchModel(conversationId, modelId, reason = 'user_choice') {
        const supabase = (0, db_1.getSupabase)();
        const modelSwitch = {
            conversation_id: conversationId,
            model_id: modelId,
            switched_at: new Date(),
            reason
        };
        const { data, error } = await supabase
            .from('conversation_models')
            .insert([modelSwitch])
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to switch model: ${error.message}`);
        }
        // Update conversation's current model
        await this.updateConversation(conversationId, {
            model: modelId
        });
        return data;
    }
    /**
     * Get current model for conversation (latest from model history or conversation model field)
     */
    async getCurrentModel(conversationId) {
        const supabase = (0, db_1.getSupabase)();
        // First, try to get the latest model switch from history
        const { data: modelHistory, error: historyError } = await supabase
            .from('conversation_models')
            .select('model_id')
            .eq('conversation_id', conversationId)
            .order('switched_at', { ascending: false })
            .limit(1)
            .single();
        if (historyError && historyError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
            throw new Error(`Failed to fetch model history: ${historyError.message}`);
        }
        if (modelHistory) {
            return modelHistory.model_id;
        }
        // Fallback to conversation's model field
        const { data: conversation, error: convError } = await supabase
            .from('conversations')
            .select('model')
            .eq('id', conversationId)
            .single();
        if (convError) {
            throw new Error(`Failed to fetch conversation model: ${convError.message}`);
        }
        if (conversation && conversation.model) {
            return conversation.model;
        }
        // Final fallback to default
        return process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
    }
    /**
     * Get conversation model history
     */
    async getConversationModelHistory(conversationId) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('conversation_models')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('switched_at', { ascending: false });
        if (error) {
            throw new Error(`Failed to fetch model history: ${error.message}`);
        }
        return data;
    }
    /**
     * Search conversations
     */
    async searchConversations(userId, query) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('conversations')
            .select(`
        *,
        conversation_messages(content)
      `)
            .eq('user_id', userId)
            .or(`title.ilike.%${query}%,conversation_messages.content.ilike.%${query}%`)
            .order('updated_at', { ascending: false });
        if (error) {
            throw new Error(`Failed to search conversations: ${error.message}`);
        }
        return data;
    }
    /**
     * Generate unique ID
     */
    generateId() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
}
exports.ConversationService = ConversationService;
// Export singleton instance
exports.conversationService = new ConversationService();
//# sourceMappingURL=conversationService.js.map