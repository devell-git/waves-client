import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

type ThemeMode = "light" | "dark";
type ThemePreference = ThemeMode | "system";

interface ThemeContextType {
  /** Tema efetivo atual (resolvido: system → light|dark). */
  mode: ThemeMode;
  /** Preferência salva: "light" | "dark" | "system" (default). */
  preference: ThemePreference;
  /** Define preferência (persiste em localStorage). */
  setPreference: (pref: ThemePreference) => void;
  /** Alterna light ↔ dark (vira override; sai de "system"). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "waves-theme-preference";

function getSystemMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function loadPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* localStorage indisponível */
  }
  return "system";
}

function resolveMode(pref: ThemePreference): ThemeMode {
  if (pref === "light" || pref === "dark") return pref;
  return getSystemMode();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(loadPreference);
  const [mode, setMode] = useState<ThemeMode>(() => resolveMode(loadPreference()));

  // Quando preference é "system", re-resolve no change do prefers-color-scheme
  useLayoutEffect(() => {
    if (preference !== "system") {
      setMode(preference);
      return;
    }
    setMode(getSystemMode());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) =>
      setMode(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  // Aplica no body
  useLayoutEffect(() => {
    document.body.setAttribute("data-theme", mode);
  }, [mode]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* persistência opcional */
    }
  }, []);

  const toggle = useCallback(() => {
    // Toggle vira override explícito (sai do "system")
    setPreference(mode === "dark" ? "light" : "dark");
  }, [mode, setPreference]);

  return (
    <ThemeContext.Provider value={{ mode, preference, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Retorna apenas o `mode` efetivo — compat com consumidores antigos. */
export function useTheme(): ThemeMode {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx.mode;
}

/** Hook completo: mode + preference + setPreference + toggle. */
export function useThemeControls(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeControls must be used within a ThemeProvider");
  }
  return ctx;
}
