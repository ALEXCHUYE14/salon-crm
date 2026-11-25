import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F7F5F0",
        surface: "#FFFFFF",
        "surface-2": "#EFECE6",
        line: "#E2DDD5",
        ink: "#1C1B19",
        muted: "#5C5852",
        sage: { DEFAULT: "#3F5E4D", dark: "#2F4739", soft: "#E3EAE5" },
        clay: { DEFAULT: "#A85A3A", dark: "#8C4A2F", soft: "#F4E5DD" },
        ochre: { DEFAULT: "#9A6B26", dark: "#7E571F", soft: "#F3E9D7" },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        display: ["Iowan Old Style", "Palatino Linotype", "Book Antiqua", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(28, 27, 25, 0.04), 0 1px 1px rgba(28, 27, 25, 0.02)",
        pop: "0 12px 32px -8px rgba(28, 27, 25, 0.18)",
      },
      borderRadius: { xl: "0.875rem" },
    },
  },
  plugins: [],
};

export default config;
