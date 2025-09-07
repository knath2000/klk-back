import { Server } from 'socket.io';
declare class WebSocketService {
    private io;
    private users;
    private conversationRooms;
    constructor(io: Server);
    private setupWebSocketHandlers;
    broadcastToConversation(conversationId: string, event: string, data: any): void;
    sendToUser(userId: string, event: string, data: any): void;
    getActiveUsersInConversation(conversationId: string): string[];
}
export declare function initializeWebSocket(io: Server): WebSocketService;
export {};
//# sourceMappingURL=websocket.d.ts.map