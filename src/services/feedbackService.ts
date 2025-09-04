import { FeedbackData, FeedbackStats, DebugResponseData } from '../types';

export class FeedbackService {
  private feedbackStore: Map<string, FeedbackData> = new Map();
  private debugStore: Map<string, DebugResponseData> = new Map();

  // Store user feedback
  storeFeedback(feedback: FeedbackData): string {
    const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.feedbackStore.set(feedbackId, {
      ...feedback,
      timestamp: Date.now()
    });

    console.log(`📝 FEEDBACK STORED: ${feedbackId} - Rating: ${feedback.rating}/5 (${feedback.category})`);
    return feedbackId;
  }

  // Store debug response data
  storeDebugData(data: DebugResponseData): void {
    this.debugStore.set(data.messageId, data);
    console.log(`🔍 DEBUG DATA STORED: ${data.messageId} - Quality Score: ${data.qualityScore}`);
  }

  // Get feedback by ID
  getFeedback(feedbackId: string): FeedbackData | null {
    return this.feedbackStore.get(feedbackId) || null;
  }

  // Get debug data by message ID
  getDebugData(messageId: string): DebugResponseData | null {
    return this.debugStore.get(messageId) || null;
  }

  // Get feedback statistics
  getFeedbackStats(): FeedbackStats {
    const feedback = Array.from(this.feedbackStore.values());
    const debugData = Array.from(this.debugStore.values());

    if (feedback.length === 0) {
      return {
        totalFeedback: 0,
        averageRating: 0,
        categoryBreakdown: {},
        recentFeedback: [],
        qualityMetrics: {
          averageQualityScore: 0,
          responseLength: { average: 0, min: 0, max: 0 },
          retryRate: 0,
          fallbackRate: 0
        }
      };
    }

    // Calculate basic stats
    const totalRating = feedback.reduce((sum, fb) => sum + fb.rating, 0);
    const averageRating = totalRating / feedback.length;

    // Category breakdown
    const categoryBreakdown: Record<string, number> = {};
    feedback.forEach(fb => {
      categoryBreakdown[fb.category] = (categoryBreakdown[fb.category] || 0) + 1;
    });

    // Recent feedback (last 10)
    const recentFeedback = feedback
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    // Quality metrics from debug data
    const qualityScores = debugData.map(d => d.qualityScore);
    const responseLengths = debugData.map(d => d.assistantResponse.length);
    const retryRate = debugData.length > 0 ?
      debugData.filter(d => d.retriesUsed > 0).length / debugData.length : 0;
    const fallbackRate = debugData.length > 0 ?
      debugData.filter(d => d.validationIssues.includes('poor_quality_after_retries')).length / debugData.length : 0;

    return {
      totalFeedback: feedback.length,
      averageRating,
      categoryBreakdown,
      recentFeedback,
      qualityMetrics: {
        averageQualityScore: qualityScores.length > 0 ?
          qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length : 0,
        responseLength: {
          average: responseLengths.length > 0 ?
            responseLengths.reduce((sum, len) => sum + len, 0) / responseLengths.length : 0,
          min: responseLengths.length > 0 ? Math.min(...responseLengths) : 0,
          max: responseLengths.length > 0 ? Math.max(...responseLengths) : 0
        },
        retryRate,
        fallbackRate
      }
    };
  }

  // Get all feedback (for admin/debugging)
  getAllFeedback(): FeedbackData[] {
    return Array.from(this.feedbackStore.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // Get all debug data (for admin/debugging)
  getAllDebugData(): DebugResponseData[] {
    return Array.from(this.debugStore.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // Clear old data (cleanup method)
  cleanupOldData(maxAgeHours: number = 24): void {
    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);

    // Clean feedback
    for (const [id, feedback] of this.feedbackStore.entries()) {
      if (feedback.timestamp < cutoffTime) {
        this.feedbackStore.delete(id);
      }
    }

    // Clean debug data
    for (const [id, debugData] of this.debugStore.entries()) {
      if (debugData.timestamp < cutoffTime) {
        this.debugStore.delete(id);
      }
    }

    console.log(`🧹 CLEANUP COMPLETED: Removed old feedback and debug data older than ${maxAgeHours} hours`);
  }

  // Export data for analysis
  exportData(): {
    feedback: FeedbackData[];
    debugData: DebugResponseData[];
    stats: FeedbackStats;
  } {
    return {
      feedback: this.getAllFeedback(),
      debugData: this.getAllDebugData(),
      stats: this.getFeedbackStats()
    };
  }
}

// Singleton instance
export const feedbackService = new FeedbackService();

// Auto cleanup every 6 hours
setInterval(() => {
  feedbackService.cleanupOldData(24); // Keep data for 24 hours
}, 6 * 60 * 60 * 1000);
