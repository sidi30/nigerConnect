import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: "#E05206",
          orangeBright: "#FF6D00",
          orangeLight: "#FF8A50",
          green: "#0DB02B",
          greenDark: "#2E7D32",
          greenSoft: "#E8F5E9",
          cream: "#FDFBF7",
          brown: "#1A0F0A",
          brownSoft: "#2D1810",
        },
        tan: {
          50: "#F8F3EB",
          100: "#F5EDE0",
          200: "#F0E6D6",
          300: "#E8E0D4",
          400: "#C4B8A6",
          500: "#8B7355",
          600: "#5D4E37",
        },
        peach: {
          50: "#FFF5F0",
          100: "#FFDCC8",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-playfair)", "Georgia", "serif"],
      },
      borderRadius: {
        "2xl": "18px",
        "3xl": "22px",
      },
      boxShadow: {
        soft: "0 1px 3px rgba(26,15,10,0.06), 0 4px 16px rgba(26,15,10,0.04)",
        card: "0 4px 20px rgba(26,15,10,0.08)",
        orange: "0 8px 28px rgba(224,82,6,0.25)",
        orangeLg: "0 12px 40px rgba(224,82,6,0.35)",
      },
      backgroundImage: {
        "gradient-orange": "linear-gradient(135deg, #E05206 0%, #FF6D00 100%)",
        "gradient-warm": "linear-gradient(160deg, #FFF5F0 0%, #FDFBF7 60%, #F5EDE0 100%)",
        "gradient-dark": "linear-gradient(160deg, #1A0F0A 0%, #2D1810 100%)",
      },
      animation: {
        "fade-up": "fadeUp 0.7s ease-out both",
        "float-slow": "floatSlow 6s ease-in-out infinite",
        "pulse-ring": "pulseRing 2.5s ease-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-12px)" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.8)", opacity: "0.7" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
