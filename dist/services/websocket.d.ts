import { Server } from 'socket.io';
declare class WebSocketService {
    private io;
    private users;
    private conversationRooms;
    private rateLimitMap;
    private guestRateLimitMap;
    private socketActivity;
    private idleTimeoutCleanup;
    private metrics;
    private static STACK_PROJECT_ID;
    private static EXPECTED_ISSUER;
    private static JWKS;
    private static EXPECTED_AUD;
    private static REQUIRE_AUTH;
    private static ALLOW_GUEST_TRANSLATION;
    constructor(io: Server);
    private startIdleTimeoutCleanup;
    private cleanupIdleConnections;
    private updateActivity;
    private setupWebSocketHandlers;
    destroy(): void;
    broadcastToConversation(conversationId: string, event: string, data: any): void;
    sendToUser(userId: string, event: string, data: any): void;
    getActiveUsersInConversation(conversationId: string): string[];
    private generateMessageId;
}
export declare function initializeWebSocket(io: Server): WebSocketService;
export {};
//# sourceMappingURL=websocket.d.ts.map