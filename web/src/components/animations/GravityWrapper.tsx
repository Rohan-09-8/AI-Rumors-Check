"use client";

import { motion } from "framer-motion";

export const GravityWrapper = ({ children, className }: { children: React.ReactNode, className?: string }) => {
  return (
    <motion.div
      className={className}
      animate={{
        y: [0, -15, 0],
      }}
      transition={{
        duration: 6,
        ease: "easeInOut", // sine-wave easing approximation
        repeat: Infinity,
      }}
    >
      {children}
    </motion.div>
  );
};
