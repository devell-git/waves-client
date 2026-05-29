import { useEffect, useRef, useState } from "react";
import {
  PROFILES,
  loadActiveProfileId,
  saveActiveProfileId,
  DEFAULT_PROFILE_ID,
} from "./ProfileTabs";

export { PROFILES, loadActiveProfileId, saveActiveProfileId, DEFAULT_PROFILE_ID };

interface ProfileSelectProps {
  activeId: string;
  onChange: (id: string) => void;
}

/**
 * Select estilizado pra trocar o profile Hermes ativo. Substitui as tabs por
 * dropdown — ocupa menos espaço quando o número de profiles crescer.
 *
 * Implementação custom (não usa <select> nativo) pra alinhar com os outros
 * componentes do chat (UserMenu, theme toggle) e suportar descrições.
 */
export function ProfileSelect({ activeId, onChange }: ProfileSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = PROFILES.find((p) => p.id === activeId) ?? PROFILES[0]!;

  return (
    <div className="profile-select" ref={rootRef}>
      <button
        type="button"
        className="profile-select-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="profile-select-label">{active.label}</span>
        <span className="profile-select-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <ul className="profile-select-menu" role="listbox">
          {PROFILES.map((p) => {
            const isActive = p.id === activeId;
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={isActive}
                className={`profile-select-option ${isActive ? "profile-select-option-active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  onChange(p.id);
                }}
              >
                <span className="profile-select-option-label">{p.label}</span>
                {p.description && (
                  <span className="profile-select-option-desc">{p.description}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
