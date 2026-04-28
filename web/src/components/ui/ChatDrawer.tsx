"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Bot } from "lucide-react";
import { ChatBubble } from "./ChatBubble";

interface Message {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  isRateLimit?: boolean;
}

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rumorId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialVerdict?: any;
}

export const ChatDrawer = ({ isOpen, onClose, rumorId, initialVerdict }: ChatDrawerProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping]);

  // Initial greeting — only once when drawer opens
  useEffect(() => {
    if (isOpen && messages.length === 0 && initialVerdict) {
      const icon = initialVerdict.verdict === "True" ? "✅" : initialVerdict.verdict === "False" ? "❌" : "🤔";
      setMessages([{
        role: "assistant",
        content: `Hi! I analysed the rumor. Verdict: **${initialVerdict.verdict}** ${icon}. Do you have questions about the reasoning or sources?`,
      }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialVerdict]);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  // Countdown timer for rate-limit cooldown
  const startCooldown = (seconds: number) => {
    setRateLimitCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setRateLimitCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const appendError = (msg: string, isRateLimit = false) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      const errMsg: Message = { role: "assistant", content: msg, isError: true, isRateLimit };
      if (last?.role === "assistant" && last.content === "") {
        return [...prev.slice(0, -1), errMsg];
      }
      return [...prev, errMsg];
    });
  };

  // ── handleSendMessage — fully independent of suggestion/search logic ──
  const handleSendMessage = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();

    const userMessage = input.trim();
    if (!userMessage) return;

    // Block if rate-limit cooldown is active
    if (rateLimitCooldown > 0) {
      appendError(`⏳ Truth Engine is cooling down... ${rateLimitCooldown}s remaining.`, true);
      return;
    }

    setInput("");
    setIsTyping(true);
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}/api/chat/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rumorId: rumorId || undefined,
            chatId: chatId || undefined,
            message: userMessage,
            verdictContext: initialVerdict ? {
              query: initialVerdict.query,
              verdict: initialVerdict.verdict,
              confidence: initialVerdict.confidence,
              reasoning: initialVerdict.reasoning,
            } : undefined,
          }),
        }
      );

      // ── 429 Rate Limit ───────────────────────────────────
      if (res.status === 429) {
        const data = await res.json().catch(() => ({ retryAfter: 30 }));
        const wait = data.retryAfter ?? 30;
        startCooldown(wait);
        appendError(`🟠 Truth Engine is cooling down... wait ${wait} seconds.`, true);
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        appendError(`⚠️ ${err.error || "Truth Engine error."}`);
        return;
      }

      const newChatId = res.headers.get("X-Chat-ID");
      if (newChatId) setChatId(newChatId);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) { appendError("⚠️ Could not read stream."); return; }

      let aiText = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") { setIsTyping(false); break; }
          try {
            const data = JSON.parse(raw);
            if (data.error) { appendError(`⚠️ ${data.error}`); return; }
            if (data.token) {
              aiText += data.token;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: aiText };
                return updated;
              });
            }
          } catch { /* non-JSON line — skip */ }
        }
      }
    } catch (err) {
      console.error("[ChatDrawer]", err);
      appendError("⚠️ Could not reach the Truth Engine. Check your connection.");
    } finally {
      setIsTyping(false);
    }
  };

  const isSendDisabled = !input.trim() || isTyping || rateLimitCooldown > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          />

          {/* Drawer panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 w-full md:w-[420px] z-50 p-4"
          >
            <div className="liquid-glass w-full h-full rounded-3xl flex flex-col overflow-hidden shadow-[-10px_0_50px_rgba(109,40,217,0.2)]">

              {/* Header */}
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-deepspace-accent/20 flex items-center justify-center border border-deepspace-accent/50">
                    <Bot className="text-deepspace-accent" size={20} />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">Truth Engine AI</h3>
                    <p className="text-white/50 text-xs">
                      {rateLimitCooldown > 0
                        ? `🟠 Cooling down — ${rateLimitCooldown}s`
                        : "Powered by Gemini 2.5 Flash"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="text-white/50 hover:text-white transition-colors p-1"
                  style={{ zIndex: 999, position: 'relative', pointerEvents: 'auto' }}
                >
                  <X size={24} />
                </button>
              </div>

              {/* Rate-limit banner */}
              <AnimatePresence>
                {rateLimitCooldown > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 py-3 bg-orange-500/10 border-b border-orange-500/20 flex items-center gap-3">
                      <span className="text-2xl">🟠</span>
                      <div>
                        <p className="text-orange-300 font-medium text-sm">Truth Engine is cooling down...</p>
                        <p className="text-orange-400/70 text-xs">Ready in {rateLimitCooldown} seconds — too many requests.</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-1">
                {messages.map((msg, i) => (
                  <ChatBubble key={i} role={msg.role} content={msg.content} isError={msg.isError} />
                ))}
                {isTyping && (
                  <div className="text-white/40 text-sm ml-4 mb-4 flex items-center gap-2">
                    {[0, 0.2, 0.4].map((delay, i) => (
                      <motion.div
                        key={i}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.5, repeat: Infinity, delay }}
                        className="w-2 h-2 rounded-full bg-white/40"
                      />
                    ))}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* ── Input Area — z-index isolated from everything above ── */}
              <div
                className="p-4 border-t border-white/10 bg-black/20 flex-shrink-0"
                style={{ position: 'relative', zIndex: 100 }}
              >
                <form onSubmit={handleSendMessage} className="relative flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    disabled={isTyping}
                    placeholder={rateLimitCooldown > 0 ? `Cooling down — ${rateLimitCooldown}s...` : "Ask about the verdict..."}
                    className="flex-1 bg-white/5 border border-white/10 rounded-full py-3 pl-5 pr-4 text-white placeholder:text-white/40 outline-none focus:border-deepspace-accent/50 transition-colors disabled:opacity-50"
                  />
                  {/* Send button — fully isolated with inline z-index + pointer-events */}
                  <button
                    type="button"
                    onClick={() => handleSendMessage()}
                    disabled={isSendDisabled}
                    style={{
                      position: 'relative',
                      zIndex: 999,
                      pointerEvents: 'auto',
                      cursor: isSendDisabled ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                    }}
                    className={`p-3 rounded-full text-white transition-all flex-shrink-0 ${
                      isSendDisabled
                        ? 'bg-white/10 opacity-40'
                        : 'bg-deepspace-accent hover:bg-deepspace-accent/80 hover:scale-105 active:scale-95'
                    }`}
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
