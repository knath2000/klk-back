import { Router } from 'express';
import { modelManager } from '../services/modelService';

const router = Router();

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

// Get model by ID
router.get('/:id', async (req, res) => {
  try {
    const model = await modelManager.getModelById(req.params.id);
    
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    res.json(model);
  } catch (error) {
    console.error('Error fetching model:', error);
    res.status(500).json({ error: 'Failed to fetch model' });
  }
});

// Switch model for conversation
router.post('/:id/switch', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { conversationId } = req.body;
    
    if (!conversationId) {
      return res.status(400).json({ error: 'Conversation ID is required' });
    }

    // In a real implementation, we would verify the user owns the conversation
    // For now, we'll just switch the model
    const model = await modelManager.switchModel(conversationId, req.params.id);
    
    res.json({ 
      success: true, 
      model: model.display_name,
      message: `Model switched to ${model.display_name}`
    });
  } catch (error) {
    console.error('Error switching model:', error);
    res.status(500).json({ error: 'Failed to switch model' });
  }
});

// Get models by capability
router.get('/capability/:capability', async (req, res) => {
  try {
    const models = await modelManager.getModelsByCapability(req.params.capability);
    res.json(models);
  } catch (error) {
    console.error('Error fetching models by capability:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

export default router;