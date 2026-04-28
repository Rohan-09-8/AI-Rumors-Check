import { Router } from 'express';
import { Rumor } from '../models/Rumor';
import mongoose from 'mongoose';

const router = Router();
const isDBConnected = () => mongoose.connection.readyState === 1;

router.get('/trending', async (_req, res) => {
  if (!isDBConnected()) return res.json([]);
  try {
    const trending = await Rumor.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('query verdict -_id');
    res.json(trending);
  } catch {
    res.json([]); // fail-safe: never 500
  }
});

router.get('/suggest', async (req, res) => {
  // Always return an array — never crash
  if (!isDBConnected()) return res.json([]);
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 2) return res.json([]);

    const suggestions = await Rumor.find(
      { $text: { $search: q.trim() } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(5)
      .select('query');

    res.json(suggestions.map((s) => s.query));
  } catch {
    res.json([]); // fail-safe: return empty array on any error
  }
});

export default router;
