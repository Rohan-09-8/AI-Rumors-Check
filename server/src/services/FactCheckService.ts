// FactCheckService.ts
// Primary  : gemini-2.5-flash  (stable, supports Google Search grounding)
// Fallback : gemini-2.0-flash  (always-available stable model)
import { Rumor } from '../models/Rumor';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mongoose from 'mongoose';

const isDBConnected = () => mongoose.connection.readyState === 1;

// ── Lazy singleton ───────────────────────────────────────────
let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is undefined in .env');
  // v1beta required for Google-Search grounding tools
  _genAI = new GoogleGenerativeAI(key);
  console.log('[FactCheck] 🔑  Gemini client initialised');
  return _genAI;
}

// Models in preference order — first one that succeeds wins
const MODEL_CASCADE = [
  'gemini-2.5-flash',   // newest stable (confirmed available)
  'gemini-2.0-flash',   // safe fallback
];

type Verdict = 'True' | 'False' | 'Unverified' | 'Mixed';

interface GeminiResult {
  verdict: Verdict;
  confidence: number;
  debunk_source: string[];
  reasoning: string;
}

// ── Service ──────────────────────────────────────────────────
export class FactCheckService {

  static async verifyRumor(query: string) {
    console.log(`[FactCheck] 🔍 Verifying: "${query.slice(0, 100)}"`);

    // Cache check
    if (isDBConnected()) {
      try {
        const cached = await Rumor.findOne({ query });
        if (cached && cached.verdict !== 'Unverified') {
          console.log(`[FactCheck] ✅ Cache hit → ${cached.verdict}`);
          return cached;
        }
      } catch (e: any) {
        console.warn('[FactCheck] Cache error:', e.message);
      }
    }

    const result = await this.geminiSearch(query);

    // Persist if DB is available
    if (isDBConnected()) {
      try {
        const rumor = new Rumor({
          query,
          verdict: result.verdict,
          confidence: result.confidence,
          debunk_sources: result.debunk_source,
          reasoning: result.reasoning,
        });
        await rumor.save();
        return rumor;
      } catch (e: any) {
        console.warn('[FactCheck] DB save error:', e.message);
      }
    }

    return {
      _id: null,
      query,
      verdict: result.verdict,
      confidence: result.confidence,
      debunk_sources: result.debunk_source,
      reasoning: result.reasoning,
    };
  }

  // ── Gemini call with model cascade ──────────────────────────
  private static async geminiSearch(query: string): Promise<GeminiResult> {
    const fallback = (reason: string): GeminiResult => ({
      verdict: 'Unverified',
      confidence: 0,
      debunk_source: [],
      reasoning: reason,
    });

    const prompt = [
      'You are the Truth Engine, a professional fact-checking AI with access to current events.',
      'Analyse the following claim carefully and respond with ONLY a valid JSON object.',
      'Do NOT include markdown fences or any text outside the JSON.',
      '',
      `Claim: "${query}"`,
      '',
      'JSON schema (respond with exactly this structure):',
      '{',
      '  "verdict": "True" | "False" | "Mixed" | "Unverified",',
      '  "confidence": <float 0.0–1.0>,',
      '  "debunk_source": ["<url>", ...],',
      '  "reasoning": "<one concise paragraph explaining your verdict>"',
      '}',
    ].join('\n');

    let lastError = '';

    for (const modelName of MODEL_CASCADE) {
      try {
        console.log(`[FactCheck] 🧠 Trying model: ${modelName}`);
        const genAI = getGenAI();

        // Use v1beta for Google Search grounding support
        const model = genAI.getGenerativeModel(
          {
            model: modelName,
            // Google Search grounding — lets the model cite live news
            tools: [{ googleSearch: {} } as any],
          },
          { apiVersion: 'v1beta' }
        );

        const response = await model.generateContent(prompt);
        const raw = response.response.text().trim();
        console.log(`[FactCheck] 📩 ${modelName} raw:`, raw.slice(0, 250));

        // Strip accidental markdown fences
        const json = raw
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
          .trim();

        const parsed = JSON.parse(json);
        const verdict: Verdict = ['True', 'False', 'Mixed', 'Unverified'].includes(parsed.verdict)
          ? parsed.verdict : 'Unverified';

        console.log(`[FactCheck] 🏁 ${modelName} → ${verdict} (${parsed.confidence})`);
        return {
          verdict,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
          debunk_source: Array.isArray(parsed.debunk_source) ? parsed.debunk_source : [],
          reasoning: parsed.reasoning || 'No reasoning provided.',
        };

      } catch (err: any) {
        lastError = err?.message ?? String(err);
        console.warn(`[FactCheck] ⚠️  Model ${modelName} failed: ${lastError.slice(0, 120)}`);

        // If not a 404 / model-not-found, don't try next model
        const isModelNotFound = lastError.includes('404') || lastError.includes('not found');
        if (!isModelNotFound) break;
      }
    }

    console.error('[FactCheck] ❌ All models failed. Last error:', lastError);
    return fallback(
      lastError.includes('API_KEY') || lastError.includes('undefined')
        ? 'GEMINI_API_KEY is missing or invalid.'
        : `Gemini error: ${lastError.slice(0, 200)}`
    );
  }
}
