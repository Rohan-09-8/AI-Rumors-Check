import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        deepspace: {
          dark: "#0F172A",
          light: "#1E1B4B",
          accent: "#6D28D9", // Violet/Indigo for glows
        }
      },
      backgroundImage: {
        'radial-mesh': 'radial-gradient(circle at 50% 50%, #1E1B4B 0%, #0F172A 100%)',
      },
      boxShadow: {
        'refractive': '0 8px 32px 0 rgba(109, 40, 217, 0.2)', // Violet at 20% opacity
      }
    },
  },
  plugins: [],
};
export default config;
