/**
 * Local Storage Manager for T3 Chat style local-first architecture
 * This service handles client-side storage of conversations for privacy
 */
export interface LocalConversation {
    id: string;
    title: string;
    model: string;
    persona_id?: string;
    messages: LocalMessage[];
    created_at: Date;
    updated_at: Date;
    is_active: boolean;
}
export interface LocalMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    model: string;
    persona_id?: string;
    tokens_used?: number;
    created_at: Date;
}
export declare class LocalStorageManager {
    private static instance;
    private storageKey;
    static getInstance(): LocalStorageManager;
    /**
     * Save conversation to local storage
     */
    saveConversation(conversation: LocalConversation): void;
    /**
     * Load conversation from local storage
     */
    loadConversation(id: string): LocalConversation | null;
    /**
     * Get all conversations from local storage
     */
    getAllConversations(): LocalConversation[];
    /**
     * Delete conversation from local storage
     */
    deleteConversation(id: string): void;
    /**
     * Clear all conversations from local storage
     */
    clearAllConversations(): void;
    /**
     * Export conversations for backup
     */
    exportConversations(): string;
    /**
     * Import conversations from backup
     */
    importConversations(backupData: string): void;
    /**
     * Get conversation count
     */
    getConversationCount(): number;
    /**
     * Check if local storage is available
     */
    isLocalStorageAvailable(): boolean;
}
export declare const localStorageManager: LocalStorageManager;
//# sourceMappingURL=localStorageManager.d.ts.map