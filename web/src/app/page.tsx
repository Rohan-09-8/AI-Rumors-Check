"use client";

import { useState } from "react";
import { GravityWrapper } from "@/components/animations/GravityWrapper";
import { FloatingSearch } from "@/components/ui/FloatingSearch";
import { ChatDrawer } from "@/components/ui/ChatDrawer";
import { Sparkles, ShieldCheck, RefreshCcw, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function Home() {
  const [isVerifying, setIsVerifying] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [verdictData, setVerdictData] = useState<any>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");

  const handleSearch = async (query: string) => {
    setIsVerifying(true);
    setVerdictData(null);
    setError(null);
    setIsChatOpen(false);
    setLastQuery(query);

    try {
      const res = await fetch(`${API_URL}/api/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error: HTTP ${res.status}`);
      }

      const data = await res.json();
      setVerdictData(data);
      setTimeout(() => setIsChatOpen(true), 1500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error("[handleSearch]", e);
      setError(msg || "Could not reach the Truth Engine. Is the backend running?");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    setVerdictData(null);
    if (lastQuery) handleSearch(lastQuery);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 overflow-hidden relative">
      {/* Decorative background */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-deepspace-accent/20 rounded-full blur-[120px] -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[150px] -z-10" />

      <GravityWrapper className="w-full flex flex-col items-center z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center justify-center p-3 liquid-glass rounded-2xl mb-6 shadow-refractive">
            <Sparkles className="text-deepspace-accent w-8 h-8" />
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-white to-white/50 mb-4 tracking-tight">
            VibeCheck AI
          </h1>
          <p className="text-white/60 text-lg md:text-xl max-w-xl mx-auto">
            The Truth Engine. Enter a rumor, myth, or claim to instantly verify its authenticity.
          </p>
        </motion.div>

        <FloatingSearch onSearch={handleSearch} className="mb-12" />

        <AnimatePresence mode="wait">
          {isVerifying && (
            <motion.div
              key="verifying"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="liquid-glass px-8 py-6 rounded-3xl flex items-center gap-4"
            >
              <div className="relative flex h-8 w-8">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-deepspace-accent opacity-75" />
                <span className="relative inline-flex rounded-full h-8 w-8 bg-deepspace-accent items-center justify-center text-white text-xs">
                  <ShieldCheck size={16} />
                </span>
              </div>
              <div>
                <h3 className="text-white font-medium text-lg">Consulting the Truth Engine...</h3>
                <p className="text-white/50 text-sm">Cross-referencing with Gemini AI.</p>
              </div>
            </motion.div>
          )}

          {error && !isVerifying && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="liquid-glass px-8 py-6 rounded-3xl max-w-2xl w-full border border-purple-500/40 shadow-[0_0_30px_rgba(139,92,246,0.2)]"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-full bg-purple-900/30 border border-purple-500/50 flex-shrink-0">
                  <AlertTriangle className="text-purple-400" size={20} />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-medium text-lg mb-1">Truth Engine Error</h3>
                  <p className="text-white/60 text-sm">{error}</p>
                </div>
              </div>
              <div className="mt-5 flex gap-3 justify-end">
                <button
                  onClick={() => { setError(null); setLastQuery(""); }}
                  className="px-5 py-2 text-white/60 hover:text-white text-sm transition-colors"
                >
                  Dismiss
                </button>
                {lastQuery && (
                  <button
                    onClick={handleRetry}
                    className="px-5 py-2 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/50 text-purple-300 hover:text-white rounded-full text-sm flex items-center gap-2 transition-all"
                  >
                    <RefreshCcw size={14} />
                    Retry
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {verdictData && !isVerifying && !isChatOpen && (
            <motion.div
              key="verdict"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="liquid-glass px-10 py-8 rounded-3xl max-w-2xl w-full border border-deepspace-accent/30 shadow-[0_0_40px_rgba(109,40,217,0.2)]"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className={`px-5 py-3 rounded-full font-bold text-xl ${
                  verdictData.verdict === "True"
                    ? "bg-green-500/20 text-green-400 border border-green-500/50"
                    : verdictData.verdict === "False"
                    ? "bg-red-500/20 text-red-400 border border-red-500/50"
                    : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/50"
                }`}>
                  {verdictData.verdict}
                </div>
                <div>
                  <h2 className="text-2xl text-white font-medium">Verdict Reached</h2>
                  <p className="text-white/50 text-sm">
                    Confidence: {(verdictData.confidence * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
              <p className="text-white/80 text-base leading-relaxed border-l-2 border-deepspace-accent/40 pl-4 py-1 italic">
                &ldquo;{verdictData.reasoning}&rdquo;
              </p>
              {verdictData.debunk_sources?.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {verdictData.debunk_sources.map((src: string, i: number) => (
                    <a
                      key={i}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-all"
                    >
                      {new URL(src.startsWith('http') ? src : `https://${src}`).hostname}
                    </a>
                  ))}
                </div>
              )}
              <div className="mt-6 flex justify-between items-center">
                <button
                  onClick={handleRetry}
                  className="text-white/40 hover:text-white/70 text-sm flex items-center gap-1 transition-colors"
                >
                  <RefreshCcw size={12} /> Re-verify
                </button>
                <button
                  onClick={() => setIsChatOpen(true)}
                  className="px-6 py-2 bg-deepspace-accent/20 hover:bg-deepspace-accent/40 border border-deepspace-accent/50 text-white rounded-full transition-all"
                >
                  Discuss Verdict →
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GravityWrapper>

      <ChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        rumorId={verdictData?._id}
        initialVerdict={verdictData}
      />
    </main>
  );
}
