import { ILLMAdapter } from './llmAdapter';
import { Persona, UserMessagePayload } from '../types';
import { Socket } from 'socket.io';
export declare class ChatService {
    private llmAdapter;
    private activeStreams;
    constructor(llmAdapter: ILLMAdapter);
    private validateResponse;
    private enhanceWithContextAwareness;
    private logResponseProcess;
    handleUserMessage(socket: Socket, payload: UserMessagePayload): Promise<void>;
    cancelRequest(messageId: string): Promise<void>;
    getPersonaList(): Persona[];
}
//# sourceMappingURL=chatService.d.ts.map