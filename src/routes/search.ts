import { Router } from 'express';
import { searchService } from '../services/searchService';

const router = Router();

// Search conversations
router.get('/:query', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversations = await searchService.searchConversations(userId, req.params.query);
    res.json(conversations);
  } catch (error) {
    console.error('Error searching conversations:', error);
    res.status(500).json({ error: 'Failed to search conversations' });
  }
});

// Search conversation messages
router.get('/messages/:query', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const messages = await searchService.searchConversationMessages(userId, req.params.query);
    res.json(messages);
  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Get search suggestions
router.get('/suggestions/:query', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const suggestions = await searchService.getSuggestions(userId, req.params.query);
    res.json(suggestions);
  } catch (error) {
    console.error('Error getting suggestions:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Get recent conversations
router.get('/recent/:limit?', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = parseInt(req.params.limit || '10');
    const conversations = await searchService.getRecentConversations(userId, limit);
    res.json(conversations);
  } catch (error) {
    console.error('Error getting recent conversations:', error);
    res.status(500).json({ error: 'Failed to get recent conversations' });
  }
});

export default router;