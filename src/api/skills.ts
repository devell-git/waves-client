// Cliente do /api/skills do Express (lê filesystem do Steve)
// Retorna metadata pra UI montar sidebar/starters dinâmicos.

export interface SkillMeta {
  name: string;
  description: string;
  category?: string;
  source: string;
  path: string;
}

interface ListResponse {
  count: number;
  skills: SkillMeta[];
}

export async function fetchSkills(): Promise<SkillMeta[]> {
  try {
    const r = await fetch("/api/skills");
    if (!r.ok) return [];
    const d = (await r.json()) as ListResponse;
    return d.skills ?? [];
  } catch {
    return [];
  }
}

/**
 * Filtra skills relevantes pra mostrar como starters (cards sugestivos).
 * Curadoria: prioriza categorias úteis no contexto Waves, evita meta-skills
 * de implementação interna.
 */
export function pickFeaturedSkills(all: SkillMeta[], limit = 6): SkillMeta[] {
  // Skills de "alta utilidade direta" pra um usuário fazer através do chat
  const PRIORITY_PREFIXES = [
    "analyze-",
    "audit-",
    "browse-",
    "diagnose-",
    "locate-",
    "manage-",
    "openui",
  ];
  const score = (s: SkillMeta): number => {
    let score = 0;
    for (let i = 0; i < PRIORITY_PREFIXES.length; i++) {
      if (s.name.startsWith(PRIORITY_PREFIXES[i])) {
        score += 100 - i; // primeiros prefixos ganham mais peso
        break;
      }
    }
    // Bonus se descrição é curta (claras demais quando >120 chars)
    if (s.description.length < 100) score += 5;
    return score;
  };
  return [...all]
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}
