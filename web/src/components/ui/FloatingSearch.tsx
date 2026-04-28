"use client";

import { useState, useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingSearchProps {
  onSearch: (query: string) => void;
  className?: string;
}

export const FloatingSearch = ({ onSearch, className }: FloatingSearchProps) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  // 3D Tilt Effect
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x, { stiffness: 300, damping: 20 });
  const mouseYSpring = useSpring(y, { stiffness: 300, damping: 20 });

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["5deg", "-5deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-5deg", "5deg"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  // Fetch suggestions — debounced 500ms, always fail-safe
  useEffect(() => {
    if (query.length < 3) { setSuggestions([]); return; }

    const delay = setTimeout(async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/search/suggest?q=${encodeURIComponent(query)}`,
          { signal: AbortSignal.timeout(3000) }
        );
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        setSuggestions([]); // silent fail — never crash
      }
    }, 500);

    return () => clearTimeout(delay);
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
      setSuggestions([]);
      setIsFocused(false);
    }
  };

  return (
    <motion.div
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn("relative w-full max-w-2xl mx-auto", className)}
    >
      <form onSubmit={handleSubmit} className="relative z-10">
        <div className={cn(
          "liquid-glass rounded-full flex items-center px-6 py-4 transition-all duration-300",
          isFocused ? "border-deepspace-accent/50 shadow-[0_0_30px_rgba(109,40,217,0.4)]" : ""
        )}>
          <Search className="text-white/60 mr-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder="Type a rumor to verify..."
            className="bg-transparent border-none outline-none text-white w-full text-lg placeholder:text-white/40"
          />
        </div>
      </form>

      {/* Auto-suggestions */}
      {suggestions.length > 0 && isFocused && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-full left-0 right-0 mt-4 liquid-glass rounded-2xl overflow-hidden z-0 p-2"
        >
          {suggestions.map((suggestion, idx) => (
            <div
              key={idx}
              className="px-4 py-3 text-white/80 hover:bg-white/10 hover:text-white cursor-pointer rounded-xl transition-colors"
              onClick={() => {
                setQuery(suggestion);
                onSearch(suggestion);
                setSuggestions([]);
              }}
            >
              {suggestion}
            </div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
};
