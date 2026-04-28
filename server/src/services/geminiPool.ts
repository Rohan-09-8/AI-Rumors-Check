// geminiPool.ts — Round-robin key pool with immediate failover
// Keys: GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3
import { GoogleGenerativeAI } from '@google/generative-ai';

interface PoolEntry {
  label: string;        // e.g. "K1:AIzaSyDM…"
  rawKey: string;       // full key for creating models
  client: GoogleGenerativeAI;
  cooldownUntil: number; // epoch ms — 0 = available
  requestCount: number;  // for diagnostics
}

let _pool: PoolEntry[] = [];
let _rrIndex = 0; // round-robin pointer

// ── Init ─────────────────────────────────────────────────────
export function initPool(): void {
  const rawKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ].filter((k): k is string => !!k && k.length > 10);

  if (rawKeys.length === 0) throw new Error('[GeminiPool] No API keys found in env!');

  _pool = rawKeys.map((k, i) => ({
    label: `K${i + 1}:${k.slice(0, 8)}…`,
    rawKey: k,
    client: new GoogleGenerativeAI(k),
    cooldownUntil: 0,
    requestCount: 0,
  }));

  console.log(`[GeminiPool] ✅ Initialised ${_pool.length} key(s)`);
}

export function getPool(): PoolEntry[] {
  if (_pool.length === 0) initPool();
  return _pool;
}

// ── Round-robin: returns next available key, wraps around ────
export function nextAvailableEntry(): PoolEntry | null {
  const pool = getPool();
  const now = Date.now();
  const total = pool.length;

  for (let i = 0; i < total; i++) {
    const idx = (_rrIndex + i) % total;
    if (pool[idx].cooldownUntil <= now) {
      _rrIndex = (idx + 1) % total; // advance pointer for next call
      return pool[idx];
    }
  }
  return null; // all on cooldown
}

export function markRateLimited(label: string, seconds = 65): void {
  const entry = getPool().find(e => e.label === label);
  if (!entry) return;
  entry.cooldownUntil = Date.now() + seconds * 1000;
  const avail = getPool().filter(e => e.cooldownUntil <= Date.now()).length;
  console.warn(`[GeminiPool] 🔴 ${label} → cooldown ${seconds}s | ${avail}/${getPool().length} keys free`);
}

export function allRateLimited(): boolean {
  return getPool().every(e => e.cooldownUntil > Date.now());
}

export function cooldownRemaining(): number {
  const now = Date.now();
  const pool = getPool();
  if (pool.some(e => e.cooldownUntil <= now)) return 0;
  return Math.ceil(Math.min(...pool.map(e => e.cooldownUntil - now)) / 1000);
}

export function poolStatus(): string {
  return getPool()
    .map(e => `${e.label}[${e.cooldownUntil > Date.now() ? '🔴' : '🟢'}]`)
    .join(' ');
}

// ── Core: generate with round-robin + immediate retry ─────────
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

export interface GeminiCallResult {
  text: string;
  usedKey: string;
  usedModel: string;
}

export async function generateWithRotation(prompt: string): Promise<GeminiCallResult> {
  const pool = getPool();
  const maxAttempts = pool.length * MODELS.length; // try every key × every model

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const entry = nextAvailableEntry();

    if (!entry) {
      const wait = cooldownRemaining();
      throw Object.assign(
        new Error(`All ${pool.length} keys rate-limited. Retry in ${wait}s.`),
        { isRateLimit: true, retryAfter: wait }
      );
    }

    for (const modelName of MODELS) {
      try {
        console.log(`[GeminiPool] 🧠 Attempt ${attempt + 1}: ${entry.label} × ${modelName}`);
        entry.requestCount++;

        const model = entry.client.getGenerativeModel(
          { model: modelName, tools: [{ googleSearch: {} } as any] },
          { apiVersion: 'v1beta' }
        );

        const response = await model.generateContent(prompt);
        const text = response.response.text().trim();

        console.log(`[GeminiPool] ✅ ${entry.label} × ${modelName} success | ${poolStatus()}`);
        return { text, usedKey: entry.label, usedModel: modelName };

      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        const is429 = msg.includes('429') || /quota|rate.?limit/i.test(msg);
        const is404 = msg.includes('404') || /not.?found|model.?not/i.test(msg);

        if (is429) {
          markRateLimited(entry.label, 65); // 65s > Gemini's 60s reset
          break; // break model loop → pick next key via outer loop
        } else if (is404) {
          console.warn(`[GeminiPool] 404 on ${modelName} — trying next model`);
          continue; // try next model with same key
        } else {
          console.error(`[GeminiPool] ❌ ${entry.label} × ${modelName}: ${msg.slice(0, 150)}`);
          break; // unexpected error — skip to next key
        }
      }
    }
  }

  throw new Error('All Gemini keys and models exhausted without a response.');
}

// ── Streaming variant with round-robin + immediate retry ──────
export async function streamWithRotation(
  systemInstruction: string,
  history: { role: string; parts: { text: string }[] }[],
  userMessage: string,
  onToken: (token: string) => void
): Promise<void> {
  const pool = getPool();
  const maxAttempts = pool.length * MODELS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const entry = nextAvailableEntry();

    if (!entry) {
      const wait = cooldownRemaining();
      throw Object.assign(
        new Error(`All ${pool.length} keys rate-limited. Retry in ${wait}s.`),
        { isRateLimit: true, retryAfter: wait }
      );
    }

    for (const modelName of MODELS) {
      try {
        console.log(`[GeminiPool/Stream] Attempt ${attempt + 1}: ${entry.label} × ${modelName}`);
        entry.requestCount++;

        const model = entry.client.getGenerativeModel(
          { model: modelName, systemInstruction },
          { apiVersion: 'v1beta' }
        );

        const session = model.startChat({ history });
        const result  = await session.sendMessageStream(userMessage);

        for await (const chunk of result.stream) {
          const token = chunk.text();
          if (token) onToken(token);
        }
        console.log(`[GeminiPool/Stream] ✅ ${entry.label} × ${modelName} | ${poolStatus()}`);
        return;

      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        const is429 = msg.includes('429') || /quota|rate.?limit/i.test(msg);
        const is404 = msg.includes('404') || /not.?found/i.test(msg);

        if (is429) {
          markRateLimited(entry.label, 65);
          break;
        } else if (is404) {
          continue;
        } else {
          console.error(`[GeminiPool/Stream] ❌ ${entry.label} × ${modelName}: ${msg.slice(0, 150)}`);
          break;
        }
      }
    }
  }

  throw new Error('All Gemini keys and models exhausted (streaming).');
}
