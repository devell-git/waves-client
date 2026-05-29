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
}

export const PROFILES: ProfileOption[] = [
  {
    id: "ybrax-negative-media",
    label: "Mídias Negativas",
    description: "Relatório de mídia adversa (CPF/CNPJ)",
  },
  {
    id: "ybrax-verifique",
    label: "Verifique",
    description: "Consulta YBRAX — dados Verifique + consultas (MAP, Mídias Negativas, etc.)",
  },
  {
    id: "bioshield-steve",
    label: "Steve",
    description: "Assistente BioShield CDMO (workflows + skills + tools Waves)",
  },
];

export const DEFAULT_PROFILE_ID = "ybrax-negative-media";
const STORAGE_KEY = "waves-active-profile";

export function loadActiveProfileId(): string {
  if (typeof window === "undefined") return DEFAULT_PROFILE_ID;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && PROFILES.some((p) => p.id === stored)) return stored;
  } catch {
    // ignora — fallback abaixo
  }
  return DEFAULT_PROFILE_ID;
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
  activeId: string;
  onChange: (id: string) => void;
}

export function ProfileTabs({ activeId, onChange }: ProfileTabsProps) {
  return (
    <div className="profile-tabs" role="tablist" aria-label="Selecionar profile">
      {PROFILES.map((p) => {
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
