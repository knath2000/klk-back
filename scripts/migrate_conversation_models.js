/**
 * One-time migration script
 *
 * Usage (run from repository root):
 *   node server/scripts/migrate_conversation_models.js
 *
 * This updates conversation.model entries that match legacy meta-llama slugs
 * to the new Google model slugs requested.
 *
 * NOTE: Review the mappings and run in a controlled environment (backup DB first).
 */

const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  // Mapping from legacy -> new
  const mapping = {
    'meta-llama/llama-3.2-3b-instruct': 'google/gemma-3-27b-it',
    'meta-llama/llama-3.3-8b-instruct:free': 'google/gemini-2.5-flash-lite',
    'meta-llama/llama-3.3-70b-instruct': 'google/gemini-2.5-flash'
  };

  try {
    console.log('Starting conversation model migration...');
    for (const [oldModel, newModel] of Object.entries(mapping)) {
      console.log(`Updating conversations with model "${oldModel}" → "${newModel}"`);
      const res = await prisma.conversation.updateMany({
        where: { model: oldModel },
        data: { model: newModel }
      });
      console.log(`  Updated ${res.count} row(s) from "${oldModel}" to "${newModel}"`);
    }

    // Optional: report any remaining legacy models
    const legacyRows = await prisma.conversation.count({
      where: {
        model: {
          in: Object.keys(mapping)
        }
      }
    });
    if (legacyRows > 0) {
      console.warn(`Warning: ${legacyRows} conversation(s) still reference legacy models. Please investigate.`);
    } else {
      console.log('Migration complete: no remaining legacy model references found in conversations table.');
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();