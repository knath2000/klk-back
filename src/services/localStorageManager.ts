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

export class LocalStorageManager {
  private static instance: LocalStorageManager;
  private storageKey = 't3_chat_conversations';

  static getInstance(): LocalStorageManager {
    if (!LocalStorageManager.instance) {
      LocalStorageManager.instance = new LocalStorageManager();
    }
    return LocalStorageManager.instance;
  }

  /**
   * Save conversation to local storage
   */
  saveConversation(conversation: LocalConversation): void {
    try {
      const conversations = this.getAllConversations();
      const existingIndex = conversations.findIndex(c => c.id === conversation.id);
      
      if (existingIndex >= 0) {
        conversations[existingIndex] = conversation;
      } else {
        conversations.push(conversation);
      }

      localStorage.setItem(this.storageKey, JSON.stringify(conversations));
    } catch (error) {
      console.error('Failed to save conversation to local storage:', error);
    }
  }

  /**
   * Load conversation from local storage
   */
  loadConversation(id: string): LocalConversation | null {
    try {
      const conversations = this.getAllConversations();
      const conversation = conversations.find(c => c.id === id);
      return conversation || null;
    } catch (error) {
      console.error('Failed to load conversation from local storage:', error);
      return null;
    }
  }

  /**
   * Get all conversations from local storage
   */
  getAllConversations(): LocalConversation[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return [];
      
      const parsed = JSON.parse(stored);
      return parsed.map((c: any) => ({
        ...c,
        created_at: new Date(c.created_at),
        updated_at: new Date(c.updated_at),
        messages: c.messages?.map((m: any) => ({
          ...m,
          created_at: new Date(m.created_at)
        })) || []
      }));
    } catch (error) {
      console.error('Failed to load conversations from local storage:', error);
      return [];
    }
  }

  /**
   * Delete conversation from local storage
   */
  deleteConversation(id: string): void {
    try {
      const conversations = this.getAllConversations();
      const filtered = conversations.filter(c => c.id !== id);
      localStorage.setItem(this.storageKey, JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to delete conversation from local storage:', error);
    }
  }

  /**
   * Clear all conversations from local storage
   */
  clearAllConversations(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error('Failed to clear conversations from local storage:', error);
    }
  }

  /**
   * Export conversations for backup
   */
  exportConversations(): string {
    try {
      const conversations = this.getAllConversations();
      return JSON.stringify({
        version: '1.0',
        exportDate: new Date().toISOString(),
        conversations
      });
    } catch (error) {
      console.error('Failed to export conversations:', error);
      return '';
    }
  }

  /**
   * Import conversations from backup
   */
  importConversations(backupData: string): void {
    try {
      const parsed = JSON.parse(backupData);
      if (parsed.version === '1.0' && parsed.conversations) {
        localStorage.setItem(this.storageKey, JSON.stringify(parsed.conversations));
      }
    } catch (error) {
      console.error('Failed to import conversations:', error);
    }
  }

  /**
   * Get conversation count
   */
  getConversationCount(): number {
    try {
      return this.getAllConversations().length;
    } catch (error) {
      console.error('Failed to get conversation count:', error);
      return 0;
    }
  }

  /**
   * Check if local storage is available
   */
  isLocalStorageAvailable(): boolean {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }
}

// Export singleton instance
export const localStorageManager = LocalStorageManager.getInstance();