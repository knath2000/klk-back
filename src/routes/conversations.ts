import { Router } from 'express';
import { conversationService } from '../services/conversationService';
import { searchService } from '../services/searchService';

const router: Router = Router();

// Get user's conversations
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversations = await conversationService.getUserConversations(userId);
    res.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Delete all conversations for the authenticated user
router.delete('/', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Require an explicit confirmation flag to avoid accidental mass deletion.
    // Accept either query ?confirm=true or JSON body { confirm: true }
    const confirmQuery = String(req.query?.confirm ?? '').toLowerCase() === 'true';
    const confirmBody = req.body && (req.body.confirm === true || String(req.body.confirm).toLowerCase() === 'true');
    if (!confirmQuery && !confirmBody) {
      return res.status(400).json({ error: 'Missing confirmation. Call DELETE /api/conversations?confirm=true to proceed.' });
    }

    await conversationService.deleteAllConversations(userId);
    return res.status(204).send();
  } catch (error) {
    console.error('Error deleting all conversations:', error);
    return res.status(500).json({ error: 'Failed to delete conversations' });
  }
});

// Create new conversation
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { title, model, persona_id } = req.body;
    
    const conversation = await conversationService.createConversation({
      user_id: userId,
      title: title || 'New Conversation',
      model: model || 'gpt-4o-mini',
      persona_id
    } as any); // Type assertion to bypass strict typing for now

    res.status(201).json(conversation);
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Get conversation by ID
router.get('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await conversationService.getConversation(req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check if user owns this conversation
    if (conversation.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(conversation);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// Update conversation
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await conversationService.getConversation(req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check if user owns this conversation
    if (conversation.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updatedConversation = await conversationService.updateConversation(req.params.id, req.body);
    res.json(updatedConversation);
  } catch (error) {
    console.error('Error updating conversation:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// Delete conversation
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await conversationService.getConversation(req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check if user owns this conversation
    if (conversation.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await conversationService.deleteConversation(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Sync conversation metadata
router.post('/:id/sync', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await conversationService.getConversation(req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check if user owns this conversation
    if (conversation.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { title, messageCount, lastMessageAt } = req.body;
    await conversationService.syncConversationMetadata(req.params.id, {
      title,
      messageCount,
      lastMessageAt: new Date(lastMessageAt)
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error syncing conversation:', error);
    res.status(500).json({ error: 'Failed to sync conversation' });
  }
});

// Search conversations
router.get('/search/:query', async (req, res) => {
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

export default router;