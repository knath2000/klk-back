import { Server } from 'socket.io';
declare class WebSocketService {
    private io;
    private users;
    private conversationRooms;
    private rateLimitMap;
    private socketActivity;
    private idleTimeoutCleanup;
    private metrics;
    constructor(io: Server);
    private startIdleTimeoutCleanup;
    private cleanupIdleConnections;
    private updateActivity;
    private setupWebSocketHandlers;
    destroy(): void;
    broadcastToConversation(conversationId: string, event: string, data: any): void;
    sendToUser(userId: string, event: string, data: any): void;
    getActiveUsersInConversation(conversationId: string): string[];
}
export declare function initializeWebSocket(io: Server): WebSocketService;
export {};
//# sourceMappingURL=websocket.d.ts.map