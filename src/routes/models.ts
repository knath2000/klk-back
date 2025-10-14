import { Router } from 'express';
import { conversationService } from '../services/conversationService';
import { modelManager } from '../services/modelService';

const router: Router = Router();

// Get all available models
router.get('/', async (req, res) => {
  try {
    const models = await modelManager.getAvailableModels();
    res.json(models);
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

router.post('/:id/switch', async (req, res) => {
  const { id } = req.params;
  const { conversationId } = req.body;

  if (!conversationId) {
    return res.status(400).json({ error: 'Conversation ID is required' });
  }

  try {
    await conversationService.switchModel(conversationId, id);
    res.json({ success: true, message: 'Model switched successfully' });
  } catch (error) {
    console.error('Error switching model:', error);
    res.status(500).json({ error: 'Failed to switch model' });
  }
});

export default router;