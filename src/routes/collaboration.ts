import { Router } from 'express';
import { collaborationService } from '../services/collaborationService';
import { conversationService } from '../services/conversationService';

const router: Router = Router();

// Share conversation with user
router.post('/conversations/:id/share', async (req, res) => {
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

    const { shared_with_id, permission } = req.body;
    const sharedConversation = await collaborationService.shareConversation(
      req.params.id,
      shared_with_id,
      userId,
      permission || 'read'
    );

    res.status(201).json(sharedConversation);
  } catch (error) {
    console.error('Error sharing conversation:', error);
    res.status(500).json({ error: 'Failed to share conversation' });
  }
});

// Get shared conversations for user
router.get('/conversations/shared', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const sharedConversations = await collaborationService.getSharedConversations(userId);
    res.json(sharedConversations);
  } catch (error) {
    console.error('Error fetching shared conversations:', error);
    res.status(500).json({ error: 'Failed to fetch shared conversations' });
  }
});

// Get users that conversation is shared with
router.get('/conversations/:id/shared', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await conversationService.getConversation(req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check if user owns this conversation or has access
    const hasAccess = await collaborationService.hasAccessToConversation(req.params.id, userId);
    if (conversation.user_id !== userId && !hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const shares = await collaborationService.getConversationShares(req.params.id);
    res.json(shares);
  } catch (error) {
    console.error('Error fetching conversation shares:', error);
    res.status(500).json({ error: 'Failed to fetch conversation shares' });
  }
});

// Update share permission
router.put('/conversations/:id/shared/:sharedWithId', async (req, res) => {
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

    const { permission } = req.body;
    const updatedShare = await collaborationService.updateSharePermission(
      req.params.id,
      req.params.sharedWithId,
      permission
    );

    res.json(updatedShare);
  } catch (error) {
    console.error('Error updating share permission:', error);
    res.status(500).json({ error: 'Failed to update share permission' });
  }
});

// Remove share
router.delete('/conversations/:id/shared/:sharedWithId', async (req, res) => {
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

    await collaborationService.removeShare(req.params.id, req.params.sharedWithId);

    res.status(204).send();
  } catch (error) {
    console.error('Error removing share:', error);
    res.status(500).json({ error: 'Failed to remove share' });
  }
});

// Check access to conversation
router.get('/conversations/:id/access', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasAccess = await collaborationService.hasAccessToConversation(req.params.id, userId);
    res.json({ hasAccess });
  } catch (error) {
    console.error('Error checking conversation access:', error);
    res.status(500).json({ error: 'Failed to check conversation access' });
  }
});

// Add collaborative message (for real-time collaboration)
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await conversationService.getConversation(req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check if user has access to this conversation
    const hasAccess = await collaborationService.hasAccessToConversation(req.params.id, userId);
    if (conversation.user_id !== userId && !hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { content, role, model } = req.body;
    const messageData = {
      conversation_id: req.params.id,
      role: role || 'user',
      content,
      model: model || conversation.model,
      user_id: userId
    };

    const message = await collaborationService.addCollaborativeMessage(req.params.id, messageData);
    res.status(201).json(message);
  } catch (error) {
    console.error('Error adding collaborative message:', error);
    res.status(500).json({ error: 'Failed to add collaborative message' });
  }
});

export default router;