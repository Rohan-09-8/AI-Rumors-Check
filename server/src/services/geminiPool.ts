// geminiPool.ts — Shared key rotation pool
// Reads all GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3 from env
// On 429, rotates to the next key automatically

import { GoogleGenerativeAI } from '@google/generative-ai';

interface PoolEntry {
  key: string;
  client: GoogleGenerativeAI;
  cooldownUntil: number; // epoch ms
}

let _pool: PoolEntry[] = [];

export function getPool(): PoolEntry[] {
  if (_pool.length > 0) return _pool;

  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ].filter((k): k is string => !!k && k.length > 10);

  if (keys.length === 0) {
    throw new Error('No Gemini API keys configured. Set GEMINI_API_KEY in .env');
  }

  _pool = keys.map((key, i) => ({
    key: `key${i + 1}:${key.slice(0, 8)}…`,
    client: new GoogleGenerativeAI(key),
    cooldownUntil: 0,
  }));

  console.log(`[GeminiPool] ✅ Loaded ${_pool.length} API key(s)`);
  return _pool;
}

// Returns the next available (non-rate-limited) client.
// If all are rate-limited, returns the one whose cooldown expires soonest.
export function getAvailableClient(): { client: GoogleGenerativeAI; keyLabel: string } {
  const pool = getPool();
  const now = Date.now();
  const available = pool.filter(e => e.cooldownUntil <= now);

  if (available.length > 0) {
    // Pick the first available (round-robin by cooldown order)
    const entry = available[0];
    return { client: entry.client, keyLabel: entry.key };
  }

  // All cooling down — pick the one with the earliest cooldown end
  const soonest = pool.reduce((a, b) => a.cooldownUntil < b.cooldownUntil ? a : b);
  console.warn(`[GeminiPool] ⚠️ All keys on cooldown — using ${soonest.key} (expires in ${Math.ceil((soonest.cooldownUntil - now) / 1000)}s)`);
  return { client: soonest.client, keyLabel: soonest.key };
}

// Mark a key as rate-limited for `seconds` seconds
export function markRateLimited(keyLabel: string, seconds = 60): void {
  const pool = getPool();
  const entry = pool.find(e => e.key === keyLabel);
  if (entry) {
    entry.cooldownUntil = Date.now() + seconds * 1000;
    console.warn(`[GeminiPool] 🔴 ${keyLabel} rate-limited for ${seconds}s`);

    // Log remaining available keys
    const available = pool.filter(e => e.cooldownUntil <= Date.now()).length;
    console.log(`[GeminiPool] 🟢 ${available}/${pool.length} keys available`);
  }
}

// Returns true if ALL keys are currently rate-limited
export function allRateLimited(): boolean {
  return getPool().every(e => e.cooldownUntil > Date.now());
}

// Returns seconds until any key becomes available (0 if one is available now)
export function cooldownRemaining(): number {
  const now = Date.now();
  const pool = getPool();
  if (pool.some(e => e.cooldownUntil <= now)) return 0;
  const soonest = pool.reduce((a, b) => a.cooldownUntil < b.cooldownUntil ? a : b);
  return Math.ceil((soonest.cooldownUntil - now) / 1000);
}
