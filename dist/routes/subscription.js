"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const subscriptionService_1 = require("../services/subscriptionService");
const router = (0, express_1.Router)();
// Get all subscription plans
router.get('/plans', async (req, res) => {
    try {
        const plans = await subscriptionService_1.subscriptionService.getSubscriptionPlans();
        res.json(plans);
    }
    catch (error) {
        console.error('Error fetching subscription plans:', error);
        res.status(500).json({ error: 'Failed to fetch subscription plans' });
    }
});
// Get user's subscription
router.get('/', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const subscription = await subscriptionService_1.subscriptionService.getUserSubscription(userId);
        res.json(subscription);
    }
    catch (error) {
        console.error('Error fetching user subscription:', error);
        res.status(500).json({ error: 'Failed to fetch subscription' });
    }
});
// Subscribe to a plan
router.post('/subscribe', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { planId } = req.body;
        if (!planId) {
            return res.status(400).json({ error: 'Plan ID is required' });
        }
        // Verify plan exists
        const plan = await subscriptionService_1.subscriptionService.getSubscriptionPlanById(planId);
        if (!plan) {
            return res.status(404).json({ error: 'Plan not found' });
        }
        const subscription = await subscriptionService_1.subscriptionService.upsertUserSubscription(userId, planId);
        res.json(subscription);
    }
    catch (error) {
        console.error('Error subscribing to plan:', error);
        res.status(500).json({ error: 'Failed to subscribe to plan' });
    }
});
// Get user usage
router.get('/usage', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { period } = req.query;
        const usage = await subscriptionService_1.subscriptionService.getUserUsage(userId, period);
        res.json(usage);
    }
    catch (error) {
        console.error('Error fetching user usage:', error);
        res.status(500).json({ error: 'Failed to fetch usage' });
    }
});
// Check usage limits
router.get('/usage/check', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { period } = req.query;
        const limits = await subscriptionService_1.subscriptionService.checkUsageLimits(userId, period);
        res.json(limits);
    }
    catch (error) {
        console.error('Error checking usage limits:', error);
        res.status(500).json({ error: 'Failed to check usage limits' });
    }
});
exports.default = router;
//# sourceMappingURL=subscription.js.map