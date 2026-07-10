/**
 * Utilitários de mensagens para o handler Hermes.
 *
 * Extraídos de server/chat.ts (split fatia 4).
 */

/**
 * Regex que detecta tokens openui-lang no conteúdo assistant. Usado por
 * truncateOldAssistantUI para identificar respostas UI renderizadas.
 */
export const OPENUI_HINT_RE =
  /\b(root\s*=|Card\s*\(|CardHeader\s*\(|Kanban\s*\(|Table\s*\(|TagBlock\s*\(|BarChart\s*\(|PieChart\s*\(|ListBlock\s*\(|Steps\s*\(|FollowUpBlock\s*\()/;

/**
 * Economia de tokens: as respostas `assistant` antigas são openui-lang longo
 * (um kanban = vários k tokens). O modelo raramente precisa da UI antiga
 * renderizada — só do que ela significou. Mantém as últimas `keepLast` cheias
 * e troca as anteriores por um marcador curto (com dica do título).
 */
export function truncateOldAssistantUI(
  msgs: Array<Record<string, unknown>>,
  keepLast = 1,
): Array<Record<string, unknown>> {
  const assistantIdx = msgs
    .map((m, i) => (m.role === "assistant" ? i : -1))
    .filter((i) => i >= 0);
  const keep = new Set(assistantIdx.slice(-keepLast));
  return msgs.map((m, i) => {
    if (m.role !== "assistant" || keep.has(i)) return m;
    const c = m.content;
    if (typeof c === "string" && c.length > 200 && OPENUI_HINT_RE.test(c)) {
      const title = c.match(/CardHeader\(\s*["']([^"']{0,60})/)?.[1];
      return { ...m, content: `[UI renderizada anteriormente${title ? `: ${title}` : ""}]` };
    }
    return m;
  });
}
