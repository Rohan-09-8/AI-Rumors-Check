"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

export const ChatBubble = ({ role, content, isError }: ChatBubbleProps) => {
  const isUser = role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 20,
        mass: 0.8,
      }}
      className={cn(
        "flex w-full mb-4",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] p-4 rounded-2xl relative",
          isUser
            ? "bg-deepspace-accent/40 text-white rounded-tr-sm backdrop-blur-md border border-deepspace-accent/50"
            : isError
            ? "border border-purple-500/60 bg-purple-900/20 text-purple-300 rounded-tl-sm shadow-[0_0_20px_rgba(139,92,246,0.3)]"
            : "liquid-glass text-white/90 rounded-tl-sm"
        )}
      >
        {content}
      </div>
    </motion.div>
  );
};
