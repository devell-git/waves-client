/**
 * Toggle visual entre light ("clean") e dark. Persiste em localStorage.
 *
 * Clica → alterna entre light ↔ dark (vira override explícito).
 * Long-press (no future) ou settings poderia voltar pra "system".
 */
import { useThemeControls } from "../hooks/use-system-theme";

export function ThemeToggle() {
  const { mode, toggle } = useThemeControls();
  const isDark = mode === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={isDark ? "Mudar para tema clean (light)" : "Mudar para tema dark"}
      aria-label={isDark ? "Tema atual: dark — clique para light" : "Tema atual: light — clique para dark"}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span
          className={`theme-toggle-thumb thumb-${isDark ? "dark" : "light"}`}
        />
      </span>
    </button>
  );
}
