/**
 * Análise descritiva de um Action Plan (modo "analítico" do relatório executivo).
 *
 * Fluxo dual: o RUNTIME recupera os dados (tasks/kanban via Query) e envia só
 * AGREGADOS (sem os itens de checklist) pra cá. Este endpoint chama o modelo do
 * agente (gpt-5.4) no gateway, com o Bearer do usuário e um prompt FOCADO de
 * analista — devolve `{conclusion, analysisHtml}`. NÃO carrega o catálogo
 * openui-lang nem pede HTML estrutural (isso é determinístico no builder).
 *
 * `POST /api/analyze-report { summary, host, port }` (Bearer do usuário).
 */
import { Router } from "express";
import { resolveHermesGateway } from "./chat.js";

export const analyzeRouter = Router();

const SYSTEM = `Você é um analista executivo de projetos (Action Plans), em português do Brasil.
Recebe AGREGADOS de um AP (contagens, custos, exceções e uma linha por ação com prazo/itens) e produz uma análise DESCRITIVA e orientada à decisão.
Responda APENAS um objeto JSON válido (sem markdown, sem cercas de código):
{"conclusion":"<parágrafo de conclusão executiva, texto puro, 3-5 frases>","analysisHtml":"<HTML inline simples (<p>, <ul><li>) com a leitura analítica: andamento geral, ações mais críticas, gargalos/dependências, leitura de custos e próximos passos sugeridos>"}
Regras: baseie-se SOMENTE nos dados recebidos (não invente números, datas ou tarefas); seja específico (cite ações, valores e prazos quando relevante); tom executivo, conciso.`;

analyzeRouter.post("/", async (req, res) => {
  const b = (req.body ?? {}) as { summary?: unknown; host?: unknown; port?: unknown };
  const auth = req.headers.authorization as string | undefined;
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return res.status(401).json({ error: "Bearer ausente" });
  if (!b.summary) return res.status(400).json({ error: "summary obrigatório" });

  const gw = resolveHermesGateway(
    b.host ? String(b.host) : undefined,
    b.port != null ? Number(b.port) : undefined,
  );
  if (!gw.ok) return res.status(gw.status).json({ error: gw.error });

  try {
    const upstream = await fetch(`${gw.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: "gpt-5.4",
        stream: false,
        max_tokens: 1600,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Dados (JSON) do AP:\n" + JSON.stringify(b.summary) },
        ],
      }),
      signal: AbortSignal.timeout(150_000),
    });
    const j = (await upstream.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const content = j?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return res.status(502).json({ error: "sem resposta do modelo" });
    }
    // Extrai o objeto JSON (tolerante a texto/cercas em volta).
    const m = content.match(/\{[\s\S]*\}/);
    let parsed: { conclusion?: unknown; analysisHtml?: unknown } | null = null;
    try {
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      parsed = null;
    }
    if (!parsed) return res.json({}); // não-parseável → cliente cai no template
    return res.json({
      conclusion: typeof parsed.conclusion === "string" ? parsed.conclusion : undefined,
      analysisHtml: typeof parsed.analysisHtml === "string" ? parsed.analysisHtml : undefined,
    });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "falha na análise" });
  }
});

// ════════════════════════════════════════════════════════════════════════
// Relatório ANALÍTICO/CUSTOM escrito pela IA, focado na INSTRUÇÃO do usuário.
// Diferente do executivo (determinístico): aqui o modelo escreve o relatório
// INTEIRO em HTML, sem o esqueleto fixo. Recebe agregados (sem bloat) + a
// instrução; devolve { html }. O client renderiza + PDF/Word.
// ════════════════════════════════════════════════════════════════════════
export const analysisReportRouter = Router();

const REPORT_SYSTEM = `Você é um analista executivo de projetos (Action Plans), em português do Brasil.
Escreva um RELATÓRIO em HTML **focado na INSTRUÇÃO do usuário**, usando SOMENTE os dados fornecidos (agregados do AP: ações, custos, prazos, exceções).
Formato da resposta: APENAS o HTML do corpo do relatório (sem markdown, sem cercas \`\`\`). Comece com <h1> com um título que reflita a instrução, depois seções <h2> com <p> e listas <ul><li>.
Conteúdo: cubra exatamente o que a instrução pede (ex.: gargalos, pendências, riscos, custos…); seja ESPECÍFICO (cite ações por id e nome, valores em R$, prazos/datas presentes nos dados); destaque criticidade, dependências e próximos passos quando fizer sentido.
Regras: não invente nada fora dos dados; não despeje listas cruas de tarefas; tom executivo e acionável.`;

function stripFences(s: string): string {
  return s.replace(/^\s*```[a-z]*\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

analysisReportRouter.post("/", async (req, res) => {
  const b = (req.body ?? {}) as { summary?: unknown; instruction?: unknown; host?: unknown; port?: unknown };
  const auth = req.headers.authorization as string | undefined;
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return res.status(401).json({ error: "Bearer ausente" });
  if (!b.summary) return res.status(400).json({ error: "summary obrigatório" });
  const instruction = typeof b.instruction === "string" && b.instruction.trim() ? b.instruction.trim() : "Análise executiva geral do AP.";

  const gw = resolveHermesGateway(b.host ? String(b.host) : undefined, b.port != null ? Number(b.port) : undefined);
  if (!gw.ok) return res.status(gw.status).json({ error: gw.error });

  try {
    const upstream = await fetch(`${gw.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: "gpt-5.4",
        stream: false,
        max_tokens: 2600,
        messages: [
          { role: "system", content: REPORT_SYSTEM },
          { role: "user", content: `Instrução do usuário: ${instruction}\n\nDados (JSON) do AP:\n${JSON.stringify(b.summary)}` },
        ],
      }),
      signal: AbortSignal.timeout(150_000),
    });
    const j = (await upstream.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const content = j?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return res.status(502).json({ error: "sem resposta do modelo" });
    }
    return res.json({ html: stripFences(content) });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "falha no relatório analítico" });
  }
});
