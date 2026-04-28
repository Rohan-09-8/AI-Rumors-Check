// ============================================================
// server/src/index.ts  — The FIRST file executed. dotenv MUST
// be loaded before ANY other import reads process.env.
// ============================================================
import dotenv from 'dotenv';
dotenv.config(); // ← MUST be first, before any service import

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

// Routes are imported AFTER dotenv.config() so they read the correct env
import searchRoutes from './routes/search';
import verifyRoutes from './routes/verify';
import chatRoutes from './routes/chat';

// ── Validate Gemini key pool at startup ─────────────────────
const geminiKeys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
].filter(Boolean);

if (geminiKeys.length === 0) {
  console.error('[FATAL] ❌  No GEMINI_API_KEY set — AI will NOT work');
} else {
  console.log(`[Config] ✅  ${geminiKeys.length} Gemini API key(s) loaded`);
}

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware (order matters) ───────────────────────────────
app.use(cors({ origin: '*', exposedHeaders: ['X-Chat-ID'] }));
app.use(express.json());                   // must be BEFORE routes
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ────────────────────────────────────────────
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// ── Routes ───────────────────────────────────────────────────
app.use('/api/search', searchRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/chat',   chatRoutes);

// ── Health ───────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  geminiKeys: [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ].filter(Boolean).length,
  db: mongoose.connection.readyState === 1,
}));

// ── Database (optional) ──────────────────────────────────────
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.warn('[DB] No MONGODB_URI — running without DB'); return; }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 6000 });
    console.log('[DB] ✅  Connected to MongoDB');
  } catch (err: any) {
    console.warn(`[DB] ⚠️  MongoDB unavailable (${err.message}) — caching disabled`);
  }
}

// ── Start ────────────────────────────────────────────────────
(async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`\n[Server] 🚀  http://localhost:${PORT}`);
    console.log(`[Server] Gemini Keys : ${geminiKeys.length} loaded ✅`);
    console.log(`[Server] DB Status   : ${mongoose.connection.readyState === 1 ? '✅ Connected' : '⚠️  Not connected'}\n`);
  });
})();
