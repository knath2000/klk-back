import { SharedConversation } from '../models/team';
import { ConversationMessage } from '../models/conversation';
export declare class CollaborationService {
    private prisma;
    /**
     * Share conversation with user
     */
    shareConversation(conversationId: string, sharedWithId: string, sharedById: string, permission?: string): Promise<SharedConversation>;
    /**
     * Get shared conversations for user
     */
    getSharedConversations(userId: string): Promise<SharedConversation[]>;
    /**
     * Get users that conversation is shared with
     */
    getConversationShares(conversationId: string): Promise<SharedConversation[]>;
    /**
     * Update share permission
     */
    updateSharePermission(conversationId: string, sharedWithId: string, permission: string): Promise<SharedConversation>;
    /**
     * Remove share
     */
    removeShare(conversationId: string, sharedWithId: string): Promise<void>;
    /**
     * Check if user has access to conversation
     */
    hasAccessToConversation(conversationId: string, userId: string): Promise<boolean>;
    /**
     * Add message to shared conversation (for real-time collaboration)
     */
    addCollaborativeMessage(conversationId: string, messageData: any): Promise<ConversationMessage>;
    /**
     * Get conversation participants
     */
    getConversationParticipants(conversationId: string): Promise<{
        user_id: string;
        permission: string;
    }[]>;
    /**
     * Get user's collaborative activity
     */
    getUserCollaborativeActivity(userId: string, limit?: number): Promise<any[]>;
    /**
     * Generate unique ID
     */
    private generateId;
}
export declare const collaborationService: CollaborationService;
//# sourceMappingURL=collaborationService.d.ts.map