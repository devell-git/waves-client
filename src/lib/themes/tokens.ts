/**
 * DESIGN TOKENS — Tenant Theme Presets
 *
 * Cada preset define DIRETAMENTE os valores das variáveis CSS do shadcn/ui.
 * Isso garante que trocar o preset muda toda a UI: fundo, cards, texto,
 * botões, inputs, bordas, gráficos — tudo.
 *
 * Variáveis mapeadas (mesmas do index.css :root / [data-theme="dark"]):
 *   --background, --foreground, --card, --card-foreground, --popover,
 *   --popover-foreground, --primary, --primary-foreground, --secondary,
 *   --secondary-foreground, --muted, --muted-foreground, --accent,
 *   --accent-foreground, --destructive, --destructive-foreground,
 *   --border, --input, --ring, --chart-1..6, --radius
 *
 * Origem dos presets: /home/erick/react_generater/ (adaptado para shadcn)
 */

/** Valores shadcn — 1:1 com as CSS variables do index.css */
export interface ShadcnVars {
  background: string;
  foreground: string;
  card: string;
  "card-foreground": string;
  popover: string;
  "popover-foreground": string;
  primary: string;
  "primary-foreground": string;
  secondary: string;
  "secondary-foreground": string;
  muted: string;
  "muted-foreground": string;
  accent: string;
  "accent-foreground": string;
  destructive: string;
  "destructive-foreground": string;
  border: string;
  input: string;
  ring: string;
  "chart-1": string;
  "chart-2": string;
  "chart-3": string;
  "chart-4": string;
  "chart-5": string;
  "chart-6": string;
}

export interface ThemeTypography {
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
}

export interface ThemePreset {
  name: string;
  description: string;
  segment: string;
  light: ShadcnVars;
  dark: ShadcnVars;
  typography: ThemeTypography;
  /** Border radius em rem */
  radius: string;
}

// ─── Presets ────────────────────────────────────────────────────────────────

export const presets: Record<string, ThemePreset> = {
  executive: {
    name: "Executive",
    description: "Sóbrio e corporativo. Tons escuros com acentos dourados.",
    segment: "corporate",
    light: {
      background: "#f8f7f4",
      foreground: "#1a1a1a",
      card: "#ffffff",
      "card-foreground": "#1a1a1a",
      popover: "#ffffff",
      "popover-foreground": "#1a1a1a",
      primary: "#78350f",
      "primary-foreground": "#fef3c7",
      secondary: "#f5f0e6",
      "secondary-foreground": "#44403c",
      muted: "#f0ede6",
      "muted-foreground": "#78716c",
      accent: "#d4a843",
      "accent-foreground": "#1c1917",
      destructive: "#c62828",
      "destructive-foreground": "#fef2f2",
      border: "#e7e0d3",
      input: "#e7e0d3",
      ring: "#b8860b",
      "chart-1": "#b8860b",
      "chart-2": "#2e7d32",
      "chart-3": "#0277bd",
      "chart-4": "#c62828",
      "chart-5": "#6a1b9a",
      "chart-6": "#00838f",
    },
    dark: {
      background: "#0c0a08",
      foreground: "#f5f0e0",
      card: "#171310",
      "card-foreground": "#f5f0e0",
      popover: "#1f1a16",
      "popover-foreground": "#f5f0e0",
      primary: "#d4af37",
      "primary-foreground": "#1c1917",
      secondary: "#292420",
      "secondary-foreground": "#e7dcc8",
      muted: "#292420",
      "muted-foreground": "#a89880",
      accent: "#b8860b",
      "accent-foreground": "#fef3c7",
      destructive: "#ff6b6b",
      "destructive-foreground": "#fef2f2",
      border: "#3d3530",
      input: "#3d3530",
      ring: "#d4af37",
      "chart-1": "#d4af37",
      "chart-2": "#4ade80",
      "chart-3": "#38bdf8",
      "chart-4": "#f87171",
      "chart-5": "#c084fc",
      "chart-6": "#22d3ee",
    },
    typography: {
      fontDisplay: "'Playfair Display', Georgia, serif",
      fontBody: "'Inter', system-ui, sans-serif",
      fontMono: "'JetBrains Mono', monospace",
    },
    radius: "0.5rem",
  },

  school: {
    name: "School",
    description: "Leve e acolhedor. Cores vibrantes e bordas arredondadas.",
    segment: "education",
    light: {
      background: "#fafbfe",
      foreground: "#1e293b",
      card: "#ffffff",
      "card-foreground": "#1e293b",
      popover: "#ffffff",
      "popover-foreground": "#1e293b",
      primary: "#6366f1",
      "primary-foreground": "#ffffff",
      secondary: "#f0f4ff",
      "secondary-foreground": "#3730a3",
      muted: "#eef2fa",
      "muted-foreground": "#64748b",
      accent: "#8b5cf6",
      "accent-foreground": "#ffffff",
      destructive: "#ef4444",
      "destructive-foreground": "#ffffff",
      border: "#e0e7f5",
      input: "#e0e7f5",
      ring: "#6366f1",
      "chart-1": "#6366f1",
      "chart-2": "#22c55e",
      "chart-3": "#f59e0b",
      "chart-4": "#ef4444",
      "chart-5": "#ec4899",
      "chart-6": "#06b6d4",
    },
    dark: {
      background: "#0f0f1e",
      foreground: "#f0f0f8",
      card: "#16162e",
      "card-foreground": "#f0f0f8",
      popover: "#1e1e3a",
      "popover-foreground": "#f0f0f8",
      primary: "#818cf8",
      "primary-foreground": "#1e1b4b",
      secondary: "#1e1e3a",
      "secondary-foreground": "#c4b5fd",
      muted: "#22224a",
      "muted-foreground": "#a0a0c0",
      accent: "#a78bfa",
      "accent-foreground": "#1e1b4b",
      destructive: "#f87171",
      "destructive-foreground": "#fef2f2",
      border: "#2e2e5e",
      input: "#2e2e5e",
      ring: "#818cf8",
      "chart-1": "#818cf8",
      "chart-2": "#34d399",
      "chart-3": "#fbbf24",
      "chart-4": "#f87171",
      "chart-5": "#f472b6",
      "chart-6": "#22d3ee",
    },
    typography: {
      fontDisplay: "'Nunito', 'Quicksand', sans-serif",
      fontBody: "'Nunito', system-ui, sans-serif",
      fontMono: "'Fira Code', monospace",
    },
    radius: "1rem",
  },

  medicine: {
    name: "Medicine",
    description: "Clean e profissional. Azul/branco com tipografia precisa.",
    segment: "healthcare",
    light: {
      background: "#f7f9fc",
      foreground: "#0f172a",
      card: "#ffffff",
      "card-foreground": "#0f172a",
      popover: "#ffffff",
      "popover-foreground": "#0f172a",
      primary: "#0284c7",
      "primary-foreground": "#ffffff",
      secondary: "#f0f5fa",
      "secondary-foreground": "#0c4a6e",
      muted: "#edf2f7",
      "muted-foreground": "#64748b",
      accent: "#0ea5e9",
      "accent-foreground": "#ffffff",
      destructive: "#dc2626",
      "destructive-foreground": "#ffffff",
      border: "#e2e8f0",
      input: "#e2e8f0",
      ring: "#0284c7",
      "chart-1": "#0284c7",
      "chart-2": "#16a34a",
      "chart-3": "#d97706",
      "chart-4": "#dc2626",
      "chart-5": "#7c3aed",
      "chart-6": "#0891b2",
    },
    dark: {
      background: "#060a10",
      foreground: "#e8f0f8",
      card: "#0f1824",
      "card-foreground": "#e8f0f8",
      popover: "#14202e",
      "popover-foreground": "#e8f0f8",
      primary: "#38bdf8",
      "primary-foreground": "#082f49",
      secondary: "#1a2840",
      "secondary-foreground": "#7dd3fc",
      muted: "#1a2840",
      "muted-foreground": "#8899bb",
      accent: "#0ea5e9",
      "accent-foreground": "#f0f9ff",
      destructive: "#f87171",
      "destructive-foreground": "#fef2f2",
      border: "#253a55",
      input: "#253a55",
      ring: "#38bdf8",
      "chart-1": "#38bdf8",
      "chart-2": "#4ade80",
      "chart-3": "#fbbf24",
      "chart-4": "#f87171",
      "chart-5": "#a78bfa",
      "chart-6": "#22d3ee",
    },
    typography: {
      fontDisplay: "'Inter', 'Roboto', sans-serif",
      fontBody: "'Inter', system-ui, sans-serif",
      fontMono: "'IBM Plex Mono', monospace",
    },
    radius: "0.625rem",
  },

  tech: {
    name: "Tech",
    description: "Futurista e moderno. Neon sobre fundo escuro.",
    segment: "technology",
    light: {
      background: "#f4f7fb",
      foreground: "#0d1117",
      card: "#ffffff",
      "card-foreground": "#0d1117",
      popover: "#ffffff",
      "popover-foreground": "#0d1117",
      primary: "#0891b2",
      "primary-foreground": "#ffffff",
      secondary: "#eef4fc",
      "secondary-foreground": "#155e75",
      muted: "#e8f0fa",
      "muted-foreground": "#64748b",
      accent: "#06b6d4",
      "accent-foreground": "#ffffff",
      destructive: "#ef4444",
      "destructive-foreground": "#ffffff",
      border: "#dce6f2",
      input: "#dce6f2",
      ring: "#0891b2",
      "chart-1": "#06b6d4",
      "chart-2": "#10b981",
      "chart-3": "#f59e0b",
      "chart-4": "#ef4444",
      "chart-5": "#a855f7",
      "chart-6": "#3b82f6",
    },
    dark: {
      background: "#0a0a0f",
      foreground: "#e8f0ff",
      card: "#111820",
      "card-foreground": "#e8f0ff",
      popover: "#161d28",
      "popover-foreground": "#e8f0ff",
      primary: "#00f0ff",
      "primary-foreground": "#0a0a0f",
      secondary: "#1b2838",
      "secondary-foreground": "#66f7ff",
      muted: "#1b2838",
      "muted-foreground": "#8899aa",
      accent: "#bf5af2",
      "accent-foreground": "#f5f0ff",
      destructive: "#ff3366",
      "destructive-foreground": "#fff0f3",
      border: "#253345",
      input: "#253345",
      ring: "#00f0ff",
      "chart-1": "#00f0ff",
      "chart-2": "#39ff14",
      "chart-3": "#ffaa00",
      "chart-4": "#ff3366",
      "chart-5": "#bf5af2",
      "chart-6": "#3b82f6",
    },
    typography: {
      fontDisplay: "'Space Grotesk', 'Inter', sans-serif",
      fontBody: "'Inter', system-ui, sans-serif",
      fontMono: "'JetBrains Mono', monospace",
    },
    radius: "0.75rem",
  },

  legal: {
    name: "Legal",
    description: "Formal e clássico. Tons neutros, bordas retas, tipografia serif.",
    segment: "legal",
    light: {
      background: "#faf9f7",
      foreground: "#1c1917",
      card: "#ffffff",
      "card-foreground": "#1c1917",
      popover: "#ffffff",
      "popover-foreground": "#1c1917",
      primary: "#78350f",
      "primary-foreground": "#fef3c7",
      secondary: "#f5f3f0",
      "secondary-foreground": "#44403c",
      muted: "#f0ece6",
      "muted-foreground": "#78716c",
      accent: "#a16207",
      "accent-foreground": "#ffffff",
      destructive: "#991b1b",
      "destructive-foreground": "#fef2f2",
      border: "#e6e0d6",
      input: "#e6e0d6",
      ring: "#78350f",
      "chart-1": "#78350f",
      "chart-2": "#166534",
      "chart-3": "#1e40af",
      "chart-4": "#991b1b",
      "chart-5": "#6b21a8",
      "chart-6": "#0e7490",
    },
    dark: {
      background: "#0c0a08",
      foreground: "#f5f0e8",
      card: "#171310",
      "card-foreground": "#f5f0e8",
      popover: "#1f1a16",
      "popover-foreground": "#f5f0e8",
      primary: "#d4a843",
      "primary-foreground": "#1c1917",
      secondary: "#2a2420",
      "secondary-foreground": "#e8c468",
      muted: "#2a2420",
      "muted-foreground": "#a89880",
      accent: "#a16207",
      "accent-foreground": "#fef3c7",
      destructive: "#f87171",
      "destructive-foreground": "#fef2f2",
      border: "#3d3530",
      input: "#3d3530",
      ring: "#d4a843",
      "chart-1": "#d4a843",
      "chart-2": "#4ade80",
      "chart-3": "#93c5fd",
      "chart-4": "#f87171",
      "chart-5": "#c084fc",
      "chart-6": "#22d3ee",
    },
    typography: {
      fontDisplay: "'Lora', Georgia, serif",
      fontBody: "'Source Sans 3', system-ui, sans-serif",
      fontMono: "'Source Code Pro', monospace",
    },
    radius: "0.25rem",
  },
};

export const DEFAULT_PRESET = "medicine";
