import { FeedbackData, FeedbackStats, DebugResponseData } from '../types';
export declare class FeedbackService {
    private feedbackStore;
    private debugStore;
    storeFeedback(feedback: FeedbackData): string;
    storeDebugData(data: DebugResponseData): void;
    getFeedback(feedbackId: string): FeedbackData | null;
    getDebugData(messageId: string): DebugResponseData | null;
    getFeedbackStats(): FeedbackStats;
    getAllFeedback(): FeedbackData[];
    getAllDebugData(): DebugResponseData[];
    cleanupOldData(maxAgeHours?: number): void;
    exportData(): {
        feedback: FeedbackData[];
        debugData: DebugResponseData[];
        stats: FeedbackStats;
    };
}
export declare const feedbackService: FeedbackService;
//# sourceMappingURL=feedbackService.d.ts.map