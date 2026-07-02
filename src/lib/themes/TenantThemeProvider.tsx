/**
 * TenantThemeProvider — aplica o preset de tema do tenant como CSS variables.
 *
 * Convive com o ThemeProvider existente (light/dark). A cadeia é:
 *   1. ThemeProvider resolve light/dark → data-theme no body
 *   2. TenantThemeProvider resolve o preset do tenant → CSS variables no :root
 *   3. shadcn consome as CSS variables → UI inteira reflete o tema
 *
 * O admin escolhe o preset no UserMenu → persiste em localStorage (só pra ele).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ShadcnVars, ThemePreset } from "./tokens";
import { presets, DEFAULT_PRESET } from "./tokens";

const STORAGE_KEY = "waves-theme-preset";

interface TenantThemeContextType {
  preset: ThemePreset;
  presetName: string;
  allPresets: Record<string, ThemePreset>;
  switchPreset: (name: string) => void;
}

const TenantThemeContext = createContext<TenantThemeContextType | undefined>(undefined);

/** Todas as variáveis shadcn que definimos. */
const SHADCN_KEYS: (keyof ShadcnVars)[] = [
  "background", "foreground", "card", "card-foreground", "popover",
  "popover-foreground", "primary", "primary-foreground", "secondary",
  "secondary-foreground", "muted", "muted-foreground", "accent",
  "accent-foreground", "destructive", "destructive-foreground",
  "border", "input", "ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6",
];

function applyPresetToCSS(vars: ShadcnVars, preset: ThemePreset) {
  const root = document.documentElement;

  // Aplica todas as variáveis shadcn
  for (const key of SHADCN_KEYS) {
    root.style.setProperty(`--${key}`, vars[key]);
  }

  // Radius
  root.style.setProperty("--radius", preset.radius);

  // Typography
  root.style.setProperty("--font-display", preset.typography.fontDisplay);
  root.style.setProperty("--font-body", preset.typography.fontBody);
  root.style.setProperty("--font-mono", preset.typography.fontMono);

  // Legacy compat
  root.style.setProperty("--brand", vars.primary);
  root.style.setProperty("--legacy-primary", vars.primary);
  root.style.setProperty("--legacy-primary-hover", vars.accent);
}

function clearPresetCSS() {
  const root = document.documentElement;
  for (const key of SHADCN_KEYS) {
    root.style.removeProperty(`--${key}`);
  }
  root.style.removeProperty("--radius");
  root.style.removeProperty("--font-display");
  root.style.removeProperty("--font-body");
  root.style.removeProperty("--font-mono");
  root.style.removeProperty("--brand");
  root.style.removeProperty("--legacy-primary");
  root.style.removeProperty("--legacy-primary-hover");
}

function loadSavedPreset(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && presets[saved]) return saved;
  } catch { /* localStorage indisponível */ }
  return DEFAULT_PRESET;
}

interface Props {
  presetName?: string;
  children: React.ReactNode;
}

export function TenantThemeProvider({ presetName, children }: Props) {
  const [currentPreset, setCurrentPreset] = useState(() => {
    const saved = loadSavedPreset();
    if (saved !== DEFAULT_PRESET) return saved;
    return presetName && presets[presetName] ? presetName : DEFAULT_PRESET;
  });

  const resolvedName = presets[currentPreset] ? currentPreset : DEFAULT_PRESET;
  const preset = presets[resolvedName];

  const switchPreset = useCallback((name: string) => {
    if (!presets[name]) return;
    setCurrentPreset(name);
    try { localStorage.setItem(STORAGE_KEY, name); } catch { /* ok */ }
  }, []);

  useEffect(() => {
    function apply() {
      const mode = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const vars = mode === "dark" ? preset.dark : preset.light;
      applyPresetToCSS(vars, preset);
    }

    // data-preset no body para CSS condicional por tema (componentes diferentes)
    document.body.setAttribute("data-preset", resolvedName);

    apply();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          apply();
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
      clearPresetCSS();
      document.body.removeAttribute("data-preset");
    };
  }, [preset]);

  const value = useMemo(
    () => ({ preset, presetName: resolvedName, allPresets: presets, switchPreset }),
    [preset, resolvedName, switchPreset],
  );

  return (
    <TenantThemeContext.Provider value={value}>
      {children}
    </TenantThemeContext.Provider>
  );
}

export function useTenantTheme(): TenantThemeContextType {
  const ctx = useContext(TenantThemeContext);
  if (!ctx) throw new Error("useTenantTheme must be used within TenantThemeProvider");
  return ctx;
}
