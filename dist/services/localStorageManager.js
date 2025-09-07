"use strict";
/**
 * Local Storage Manager for T3 Chat style local-first architecture
 * This service handles client-side storage of conversations for privacy
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.localStorageManager = exports.LocalStorageManager = void 0;
class LocalStorageManager {
    constructor() {
        this.storageKey = 't3_chat_conversations';
    }
    static getInstance() {
        if (!LocalStorageManager.instance) {
            LocalStorageManager.instance = new LocalStorageManager();
        }
        return LocalStorageManager.instance;
    }
    /**
     * Save conversation to local storage
     */
    saveConversation(conversation) {
        try {
            const conversations = this.getAllConversations();
            const existingIndex = conversations.findIndex(c => c.id === conversation.id);
            if (existingIndex >= 0) {
                conversations[existingIndex] = conversation;
            }
            else {
                conversations.push(conversation);
            }
            localStorage.setItem(this.storageKey, JSON.stringify(conversations));
        }
        catch (error) {
            console.error('Failed to save conversation to local storage:', error);
        }
    }
    /**
     * Load conversation from local storage
     */
    loadConversation(id) {
        try {
            const conversations = this.getAllConversations();
            const conversation = conversations.find(c => c.id === id);
            return conversation || null;
        }
        catch (error) {
            console.error('Failed to load conversation from local storage:', error);
            return null;
        }
    }
    /**
     * Get all conversations from local storage
     */
    getAllConversations() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored)
                return [];
            const parsed = JSON.parse(stored);
            return parsed.map((c) => ({
                ...c,
                created_at: new Date(c.created_at),
                updated_at: new Date(c.updated_at),
                messages: c.messages?.map((m) => ({
                    ...m,
                    created_at: new Date(m.created_at)
                })) || []
            }));
        }
        catch (error) {
            console.error('Failed to load conversations from local storage:', error);
            return [];
        }
    }
    /**
     * Delete conversation from local storage
     */
    deleteConversation(id) {
        try {
            const conversations = this.getAllConversations();
            const filtered = conversations.filter(c => c.id !== id);
            localStorage.setItem(this.storageKey, JSON.stringify(filtered));
        }
        catch (error) {
            console.error('Failed to delete conversation from local storage:', error);
        }
    }
    /**
     * Clear all conversations from local storage
     */
    clearAllConversations() {
        try {
            localStorage.removeItem(this.storageKey);
        }
        catch (error) {
            console.error('Failed to clear conversations from local storage:', error);
        }
    }
    /**
     * Export conversations for backup
     */
    exportConversations() {
        try {
            const conversations = this.getAllConversations();
            return JSON.stringify({
                version: '1.0',
                exportDate: new Date().toISOString(),
                conversations
            });
        }
        catch (error) {
            console.error('Failed to export conversations:', error);
            return '';
        }
    }
    /**
     * Import conversations from backup
     */
    importConversations(backupData) {
        try {
            const parsed = JSON.parse(backupData);
            if (parsed.version === '1.0' && parsed.conversations) {
                localStorage.setItem(this.storageKey, JSON.stringify(parsed.conversations));
            }
        }
        catch (error) {
            console.error('Failed to import conversations:', error);
        }
    }
    /**
     * Get conversation count
     */
    getConversationCount() {
        try {
            return this.getAllConversations().length;
        }
        catch (error) {
            console.error('Failed to get conversation count:', error);
            return 0;
        }
    }
    /**
     * Check if local storage is available
     */
    isLocalStorageAvailable() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        }
        catch (e) {
            return false;
        }
    }
}
exports.LocalStorageManager = LocalStorageManager;
// Export singleton instance
exports.localStorageManager = LocalStorageManager.getInstance();
//# sourceMappingURL=localStorageManager.js.map