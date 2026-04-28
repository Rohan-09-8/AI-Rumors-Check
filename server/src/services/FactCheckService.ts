// FactCheckService.ts
import { Rumor } from '../models/Rumor';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mongoose from 'mongoose';

const isDBConnected = () => mongoose.connection.readyState === 1;

let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is undefined in .env');
  _genAI = new GoogleGenerativeAI(key);
  console.log('[FactCheck] 🔑 Gemini client initialised');
  return _genAI;
}

// Confirmed available models — tried in order on 404/429
const MODEL_CASCADE = ['gemini-2.5-flash', 'gemini-2.0-flash'];

type Verdict = 'True' | 'False' | 'Unverified' | 'Mixed';

interface GeminiResult {
  verdict: Verdict;
  confidence: number;
  debunk_source: string[];
  reasoning: string;
  rateLimited?: boolean;
}

export class FactCheckService {

  static async verifyRumor(query: string): Promise<{
    _id: string | null;
    query: string;
    verdict: Verdict;
    confidence: number;
    debunk_sources: string[];
    reasoning: string;
    rateLimited?: boolean;
  }> {
    console.log(`[FactCheck] 🔍 Verifying: "${query.slice(0, 100)}"`);

    // Cache check
    if (isDBConnected()) {
      try {
        const cached = await Rumor.findOne({ query });
        if (cached && cached.verdict !== 'Unverified') {
          console.log(`[FactCheck] ✅ Cache hit → ${cached.verdict}`);
          return {
            _id: cached._id?.toString() ?? null,
            query: cached.query,
            verdict: cached.verdict as Verdict,
            confidence: cached.confidence,
            debunk_sources: cached.debunk_sources ?? [],
            reasoning: cached.reasoning,
          };
        }
      } catch (e: any) {
        console.warn('[FactCheck] Cache error:', e.message);
      }
    }

    const result = await this.geminiSearch(query);

    // If rate limited, return early without saving
    if (result.rateLimited) {
      return { _id: null, query, ...result, debunk_sources: result.debunk_source };
    }

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
        return {
          _id: rumor._id?.toString() ?? null,
          query,
          verdict: result.verdict,
          confidence: result.confidence,
          debunk_sources: result.debunk_source,
          reasoning: result.reasoning,
        };
      } catch (e: any) {
        console.warn('[FactCheck] DB save error:', e.message);
      }
    }

    return { _id: null, query, ...result, debunk_sources: result.debunk_source };
  }

  private static async geminiSearch(query: string): Promise<GeminiResult> {
    const fallback = (reason: string, rateLimited = false): GeminiResult => ({
      verdict: 'Unverified',
      confidence: 0,
      debunk_source: [],
      reasoning: reason,
      rateLimited,
    });

    const prompt = [
      'You are the Truth Engine, a professional fact-checking AI.',
      'Analyse the following claim and respond with ONLY a valid JSON object — no markdown, no prose.',
      '',
      `Claim: "${query}"`,
      '',
      'Required JSON:',
      '{"verdict":"True"|"False"|"Mixed"|"Unverified","confidence":<0.0-1.0>,"debunk_source":["<url>",...],"reasoning":"<one paragraph>"}',
    ].join('\n');

    let lastError = '';

    for (const modelName of MODEL_CASCADE) {
      try {
        console.log(`[FactCheck] 🧠 Trying ${modelName}...`);
        const model = getGenAI().getGenerativeModel(
          { model: modelName, tools: [{ googleSearch: {} } as any] },
          { apiVersion: 'v1beta' }
        );

        const response = await model.generateContent(prompt);
        const raw = response.response.text().trim();
        console.log(`[FactCheck] 📩 Raw (${modelName}):`, raw.slice(0, 200));

        const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
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
        console.warn(`[FactCheck] ⚠️ ${modelName} failed: ${lastError.slice(0, 120)}`);

        // 429 = rate limit — return immediately, don't try next model
        if (lastError.includes('429') || lastError.toLowerCase().includes('quota') || lastError.toLowerCase().includes('rate')) {
          console.error('[FactCheck] 🚦 Rate limit hit — cooling down');
          return fallback('RATE_LIMITED', true);
        }

        // Only cascade on 404 / model not found
        const isNotFound = lastError.includes('404') || lastError.toLowerCase().includes('not found');
        if (!isNotFound) break;
      }
    }

    return fallback(`Gemini error: ${lastError.slice(0, 200)}`);
  }
}
