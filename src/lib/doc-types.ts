/**
 * Resolução de tipo de documento (DocumentType) DATA-DRIVEN, sem hardcode.
 *
 * O "modelo/nomenclatura" de um PDF na Waves é o **DocumentType** (header,
 * footer, background, branding). Ao criar um documento (`POST /documents`) é o
 * `document_type_id` que decide o molde. NUNCA pegar "o 1º global" (era o bug:
 * o tenant tinha `Document Eliana` (id 1) na frente de `Timbrado Bioshield`
 * (id 2) → todo relatório saía no modelo errado).
 *
 * Fonte correta: o **escopo do agente** vindo do login
 * (`agent.document_type_ids`). Regra (igual à skill `manage-documents §0`):
 *   - 1 tipo  → usa direto (sem perguntar);
 *   - >1 tipo → o chamador mostra um SELECT pro usuário escolher;
 *   - 0 tipo  → fallback: lista global (o chamador decide / mostra select).
 */
import { loadSession } from "./session";
import { getActiveAgentDocTypeIds } from "./openui-tools";

export interface DocType {
  id: number;
  name: string;
}

/** Lista TODOS os DocumentTypes do tenant (GET /document-types) com nome. */
async function fetchAllDocTypes(): Promise<DocType[]> {
  const s = loadSession();
  const headers: Record<string, string> = {};
  if (s?.accessToken) headers.Authorization = `Bearer ${s.accessToken}`;
  const r = await fetch("/api/waves/document-types", { headers });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const d = (body?.data ?? body) as Record<string, unknown>;
  // A Waves devolve { data: { document_types: [...] } }; cobre rows/data/array.
  const list = (d?.document_types ??
    d?.rows ??
    d?.data ??
    (Array.isArray(d) ? d : Array.isArray(body) ? body : [])) as Array<
    Record<string, unknown>
  >;
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && x.id != null)
    .map((x) => ({ id: Number(x.id), name: String(x.name ?? `Tipo ${x.id}`) }));
}

/**
 * Tipos de documento que o AGENTE ATIVO pode usar (escopo do login), já com
 * nome resolvido pra exibir no select. Sem escopo definido → lista global
 * (o chamador aplica a regra 1/>1/0).
 */
export async function resolveAgentDocTypes(): Promise<DocType[]> {
  const ids = getActiveAgentDocTypeIds();
  if (ids && ids.length) {
    const all = await fetchAllDocTypes();
    const scoped = all.filter((t) => ids.includes(t.id));
    if (scoped.length) return scoped;
    // ids existem mas /document-types não trouxe (permissão?): devolve por id.
    return ids.map((id) => ({ id, name: `Tipo ${id}` }));
  }
  // SEM escopo do agente na sessão. Causas: (a) sessão ANTIGA — o vínculo
  // agente↔tipo foi criado depois do login (→ re-login resolve); ou (b) agente
  // sem restrição cadastrada. NÃO devolvemos o catálogo global aqui de
  // propósito: surfacing o catálogo inteiro fazia aparecer "Document Eliana"
  // (tipo de outro contexto) no select, mesmo a Waves só vinculando Bioshield.
  // [] sinaliza "escopo não carregado" → o chamador pede re-login.
  return [];
}

/** true quando há agente ativo mas a sessão não traz o escopo de tipos (sessão
 *  antiga — o vínculo foi criado depois do login). O picker usa pra orientar
 *  re-login em vez de mostrar o catálogo global. */
export function agentDocScopeStale(): boolean {
  return getActiveAgentDocTypeIds() == null;
}
