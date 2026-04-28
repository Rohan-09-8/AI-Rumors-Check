"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Bot } from "lucide-react";
import { ChatBubble } from "./ChatBubble";

interface Message {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping]);

  useEffect(() => {
    if (isOpen && messages.length === 0 && initialVerdict) {
      // Create initial greeting based on verdict
      let icon = "🤔";
      if (initialVerdict.verdict === "True") icon = "✅";
      if (initialVerdict.verdict === "False") icon = "❌";
      
      setMessages([
        {
          role: "assistant",
          content: `Hi! I analyzed the rumor. The verdict is ${initialVerdict.verdict} ${icon}. Do you have any questions about the reasoning or sources?`
        }
      ]);
    }
  }, [isOpen, initialVerdict, messages.length]);

  const showError = (msg: string) => {
    setMessages(prev => {
      // Replace empty assistant placeholder if one exists, otherwise append
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.content === "") {
        return [...prev.slice(0, -1), { role: "assistant" as const, content: msg, isError: true }];
      }
      return [...prev, { role: "assistant" as const, content: msg, isError: true }];
    });
  };

  const sendMessage = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    console.log('Button Clicked!'); // debug — verifies handler fires
    if (!input.trim() || (!rumorId && !chatId)) {
      console.warn('[ChatDrawer] Blocked — input empty or no rumorId/chatId');
      return;
    }

    const userMessage = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsTyping(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}/api/chat/stream`, {
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
        })
      });

      // Handle non-streaming HTTP errors (400, 500, etc.)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `Server error: HTTP ${res.status}` }));
        showError(`⚠️ ${errData.error || "The Truth Engine encountered an error."}`);
        return;
      }

      const newChatId = res.headers.get("X-Chat-ID");
      if (newChatId) setChatId(newChatId);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        showError("⚠️ Could not read stream from server.");
        return;
      }

      let assistantMessage = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "").trim();
            if (dataStr === "[DONE]") { setIsTyping(false); break; }
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                if (data.error) {
                  // Structured error sent through the stream
                  showError(`⚠️ ${data.error}`);
                  return;
                }
                if (data.token) {
                  assistantMessage += data.token;
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: "assistant", content: assistantMessage };
                    return updated;
                  });
                }
              } catch {
                // Non-JSON chunk — ignore
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("[ChatDrawer] Fetch error:", error);
      showError("⚠️ Could not reach the Truth Engine. Is the backend running?");
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 w-full md:w-[400px] z-50 p-4"
          >
            <div className="liquid-glass w-full h-full rounded-3xl flex flex-col overflow-hidden shadow-[-10px_0_50px_rgba(109,40,217,0.15)]">
              {/* Header */}
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-deepspace-accent/20 flex items-center justify-center border border-deepspace-accent/50">
                    <Bot className="text-deepspace-accent" size={20} />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">Truth Engine AI</h3>
                    <p className="text-white/50 text-xs">Always learning</p>
                  </div>
                </div>
                <button onClick={onClose} className="text-white/50 hover:text-white transition-colors">
                  <X size={24} />
                </button>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                {messages.map((msg, i) => (
                  <ChatBubble key={i} role={msg.role} content={msg.content} isError={msg.isError} />
                ))}
                {isTyping && (
                  <div className="text-white/40 text-sm ml-4 mb-4 flex items-center gap-2">
                    <motion.div
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-white/40"
                    />
                    <motion.div
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
                      className="w-2 h-2 rounded-full bg-white/40"
                    />
                    <motion.div
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
                      className="w-2 h-2 rounded-full bg-white/40"
                    />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 border-t border-white/10 bg-black/20" style={{ position: 'relative', zIndex: 10 }}>
                <form
                  onSubmit={sendMessage}
                  className="relative flex items-center"
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Ask about the verdict..."
                    className="w-full bg-white/5 border border-white/10 rounded-full py-3 pl-5 pr-14 text-white placeholder:text-white/40 outline-none focus:border-deepspace-accent/50 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || isTyping}
                    style={{ position: 'absolute', right: '8px', zIndex: 999, pointerEvents: 'auto', cursor: 'pointer' }}
                    className="p-2 bg-deepspace-accent text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-deepspace-accent/80 transition-colors"
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
