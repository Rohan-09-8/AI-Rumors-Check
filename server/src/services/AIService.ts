// AIService.ts — Gemini streaming chat
// Primary  : gemini-2.5-flash
// Fallback : gemini-2.0-flash
import { Response } from 'express';
import { Chat } from '../models/Chat';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mongoose from 'mongoose';

const isDBConnected = () => mongoose.connection.readyState === 1;

// ── Lazy singleton ───────────────────────────────────────────
let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is undefined in .env');
  _genAI = new GoogleGenerativeAI(key);
  return _genAI;
}

const MODEL_CASCADE = ['gemini-2.5-flash', 'gemini-2.0-flash'];

// ── SSE helpers ──────────────────────────────────────────────
function startSSE(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}
const send = (res: Response, payload: object) =>
  res.write(`data: ${JSON.stringify(payload)}\n\n`);

const sendError = (res: Response, msg: string) => {
  send(res, { error: msg });
  res.write('data: [DONE]\n\n');
  res.end();
};

// ── Try each model in cascade ────────────────────────────────
async function tryModelStream(
  systemInstruction: string,
  history: { role: string; parts: { text: string }[] }[],
  userMessage: string,
  onToken: (t: string) => void
): Promise<void> {
  const genAI = getGenAI();
  let lastErr = '';

  for (const modelName of MODEL_CASCADE) {
    try {
      console.log(`[AIService] 🧠 Trying ${modelName}...`);
      const model = genAI.getGenerativeModel(
        { model: modelName, systemInstruction },
        { apiVersion: 'v1beta' }
      );
      const session = model.startChat({ history });
      const result  = await session.sendMessageStream(userMessage);

      for await (const chunk of result.stream) {
        const token = chunk.text();
        if (token) onToken(token);
      }
      console.log(`[AIService] ✅ ${modelName} stream complete`);
      return; // success — exit cascade

    } catch (err: any) {
      lastErr = err?.message ?? String(err);
      const isModelNotFound = lastErr.includes('404') || lastErr.includes('not found');
      console.warn(`[AIService] ⚠️  ${modelName} failed: ${lastErr.slice(0, 100)}`);
      if (!isModelNotFound) break;
    }
  }
  throw new Error(`All models failed. Last: ${lastErr}`);
}

// ── Exported service ─────────────────────────────────────────
export class AIService {

  // With DB — full conversation persistence
  static async streamChatResponse(res: Response, chatId: string, newMessage: string) {
    startSSE(res);
    console.log('[AIService] 🟢 SSE started  chatId:', chatId);
    console.log('Button Clicked!');

    try {
      const chat = await Chat.findById(chatId).populate('rumorId');
      if (!chat) return sendError(res, 'Chat session not found.');

      const sanitized = newMessage.replace(/[\u0000-\u001F\u007F]/g, '').trim();
      chat.messages.push({ role: 'user', content: sanitized, timestamp: new Date() });
      await chat.save();

      const rumor = chat.rumorId as any;
      const systemInstruction = rumor
        ? `You are the Truth Engine AI. Context — Rumor: "${rumor.query}". Verdict: ${rumor.verdict}. Confidence: ${Math.round((rumor.confidence || 0) * 100)}%. Reasoning: ${rumor.reasoning}. Answer the user concisely and accurately.`
        : 'You are the Truth Engine AI. Help users understand and verify claims.';

      const history = chat.messages.slice(0, -1).map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

      let full = '';
      await tryModelStream(systemInstruction, history, sanitized, (token) => {
        full += token;
        send(res, { token });
      });

      chat.messages.push({ role: 'assistant', content: full.trim(), timestamp: new Date() });
      await chat.save();
      res.write('data: [DONE]\n\n');
      res.end();

    } catch (err: any) {
      console.error('[AIService] ❌', err?.message);
      sendError(res, err?.message?.includes('API_KEY')
        ? 'GEMINI_API_KEY is invalid or missing.'
        : 'Truth Engine error. Please try again.');
    }
  }

  // Without DB — stateless, context passed inline
  static async streamChatResponseNoDB(
    res: Response,
    userMessage: string,
    context?: { query?: string; verdict?: string; confidence?: number; reasoning?: string }
  ) {
    startSSE(res);
    console.log('[AIService/NoDB] 🟢 SSE started (no DB)');
    console.log('Button Clicked!');

    try {
      const sanitized = userMessage.replace(/[\u0000-\u001F\u007F]/g, '').trim();
      const systemInstruction = context?.query
        ? `You are the Truth Engine AI. Context — Rumor: "${context.query}". Verdict: ${context.verdict}. Confidence: ${Math.round((context.confidence || 0) * 100)}%. Reasoning: ${context.reasoning}. Answer concisely.`
        : 'You are the Truth Engine AI. Help users understand and verify claims.';

      await tryModelStream(systemInstruction, [], sanitized, (token) => send(res, { token }));

      res.write('data: [DONE]\n\n');
      res.end();

    } catch (err: any) {
      console.error('[AIService/NoDB] ❌', err?.message);
      sendError(res, err?.message?.includes('API_KEY')
        ? 'GEMINI_API_KEY is invalid or missing.'
        : 'Truth Engine error. Please try again.');
    }
  }
}
