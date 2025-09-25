import { SubscriptionPlan } from '../models/conversation';
export declare class SubscriptionService {
    private prisma;
    private subscriptionPlans;
    /**
     * Get all subscription plans
     */
    getSubscriptionPlans(): Promise<SubscriptionPlan[]>;
    /**
     * Get subscription plan by ID
     */
    getSubscriptionPlanById(id: string): Promise<SubscriptionPlan | undefined>;
    /**
     * Track message usage for user
     */
    trackMessageUsage(userId: string, modelId: string, tokensUsed: number): Promise<void>;
    /**
     * Get user's usage for current period
     */
    getUserUsage(userId: string, period?: string): Promise<{
        tokens_used: number;
    } | null>;
    /**
     * Check if user has exceeded usage limits
     */
    checkUsageLimits(userId: string, period?: string): Promise<{
        exceeded: boolean;
        limit?: number;
        used?: number;
    }>;
    /**
     * Get user subscription
     */
    getUserSubscription(userId: string): Promise<any>;
    /**
     * Create or update user subscription
     */
    upsertUserSubscription(userId: string, planId: string): Promise<any>;
}
export declare const subscriptionService: SubscriptionService;
//# sourceMappingURL=subscriptionService.d.ts.map