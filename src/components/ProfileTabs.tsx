/**
 * ProfileTabs — abas no topo do chat pra selecionar o profile Hermes ativo.
 *
 * Hoje a lista é fixa (negative-media + map). Quando o backend expor
 * /api/profiles, vira dinâmico.
 *
 * Quando o user troca de aba, o `profileId` selecionado é persistido em
 * localStorage e enviado no body de cada `/api/chat` (campo `profile`). O
 * Express roteia pra gateway correto (18862 / 18864).
 */

export interface ProfileOption {
  id: string;
  label: string;
  /** Subtítulo curto pra hover/tooltip. */
  description?: string;
  /** Porta do gateway roteável (vinda do registry do servidor). */
  port?: number;
}


export const DEFAULT_PROFILE_ID = "ybrax-negative-media";
const STORAGE_KEY = "waves-active-profile";

/**
 * Lê o profile ativo salvo, validando contra a lista de profiles disponíveis
 * (os que vieram no login do usuário). Se o salvo não estiver disponível,
 * cai no primeiro disponível.
 */
export function loadActiveProfileId(available?: ProfileOption[]): string {
  const fallback = available?.[0]?.id ?? DEFAULT_PROFILE_ID;
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      if (!available) return stored;
      if (available.some((p) => p.id === stored)) return stored;
    }
  } catch {
    // ignora — fallback abaixo
  }
  return fallback;
}

export function saveActiveProfileId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignora
  }
}

interface ProfileTabsProps {
  profiles: ProfileOption[];
  activeId: string;
  onChange: (id: string) => void;
}

export function ProfileTabs({ profiles, activeId, onChange }: ProfileTabsProps) {
  return (
    <div className="profile-tabs" role="tablist" aria-label="Selecionar profile">
      {profiles.map((p) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`profile-tab ${active ? "profile-tab-active" : ""}`}
            onClick={() => onChange(p.id)}
            title={p.description}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
