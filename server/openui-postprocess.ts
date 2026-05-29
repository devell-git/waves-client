export interface FollowUpContext {
  workflowId?: number;
}

/**
 * Garante FollowUpBlock no openui-lang quando o modelo omite (comum em respostas longas com Tabs).
 * openui-lang suporta hoisting — followUps pode ser referenciado em root antes da definição.
 */
export function ensureFollowUps(
  lang: string,
  ctx: FollowUpContext = {},
): { content: string; appended: boolean } {
  if (/FollowUpBlock\s*\(/.test(lang)) {
    return { content: lang, appended: false };
  }

  // Resposta de texto puro (saudação, agradecimento, confirmação): NÃO
  // envolver em Card nem apendar FollowUpBlock. SOUL REGRA ZERO determina
  // que "oi", "obrigado", "ok", etc. são texto cru — apendar
  // FollowUpBlock aqui causaria o exato anti-pattern proibido (Card pra
  // saudação).
  if (!hasOpenUiConstructs(lang)) {
    return { content: lang, appended: false };
  }

  const wf = ctx.workflowId;
  const fuLines = [
    "followUps = FollowUpBlock([fu1, fu2, fu3])",
    `fu1 = FollowUpItem("${wf ? `Dashboard workflow ${wf}` : "Ver dashboard"}")`,
    `fu2 = FollowUpItem("${wf ? "Tasks por stage" : "Listar workflows"}")`,
    `fu3 = FollowUpItem("${wf ? `Detalhe workflow ${wf}` : "Comparar em tabela"}")`,
  ].join("\n");

  let content = lang.trimEnd();
  const rootRe = /^root\s*=\s*Card\(\[([\s\S]*?)\]\)\s*$/m;

  if (rootRe.test(content)) {
    content = content.replace(rootRe, (_match, inner: string) => {
      const trimmed = inner.trim();
      if (/\bfollowUps\b/.test(trimmed)) {
        return `root = Card([${trimmed}])`;
      }
      const children = trimmed ? `${trimmed}, followUps` : "followUps";
      return `root = Card([${children}])`;
    });
  } else {
    content = `root = Card([followUps])\n${content}`;
  }

  return { content: `${content}\n${fuLines}\n`, appended: true };
}

/**
 * Heurística: a resposta contém pelo menos UMA construção openui-lang
 * (root, Card, TextContent, etc.)? Se não, é texto puro e deve ser
 * preservada como-é pelo postprocessor.
 */
function hasOpenUiConstructs(s: string): boolean {
  return /\b(root\s*=|Card\s*\(|CardHeader\s*\(|TextContent\s*\(|Table\s*\(|TagBlock\s*\(|Alert\s*\(|FollowUpItem\s*\(|(?:Pie|Bar|Line)Chart\s*\(|ListBlock\s*\(|Accordion\s*\()/.test(s);
}

/**
 * Normaliza sintaxe legada do Table pra canônica do shadcn-genui.
 *
 * O LLM ocasionalmente emite `Table([row1, row2])` com `TableRow`/`TableCell`/
 * `TableHeader` dentro — sintaxe HTML-like que o Renderer NÃO reconhece. O
 * componente `Table` do `shadcn-genui` aceita SÓ `Table(columns=[Col(header=...)],
 * rows=[[...]])`. Este normalizador detecta blocks legados e reescreve antes
 * de devolver pro frontend.
 *
 * Retorna `{ content, rewrites }` com o número de Tables convertidas.
 */
export function normalizeTableSyntax(lang: string): {
  content: string;
  rewrites: number;
} {
  // Detecta padrões `Table([row1, row2, ...])` (sem `columns=`/`rows=`)
  // OU presença de `TableRow(`/`TableCell(`/`TableHeader(`.
  const legacyMarkers = /\b(TableRow|TableCell|TableHeader|TableBody)\s*\(/;
  if (!legacyMarkers.test(lang)) return { content: lang, rewrites: 0 };

  let content = lang;
  let rewrites = 0;

  // Pattern: capturar um Table([...]) inteiro (sem nested) e suas refs.
  // Estratégia: extrair table_var via match `(\w+)\s*=\s*Table\(\[([^\]]+)\]\)`,
  // resolver cada item da lista (espera identifier referenciando TableRow),
  // converter pra Table(columns=[...], rows=[[...]]).

  const tableAssignRe = /(\b\w+)\s*=\s*Table\(\s*\[([^\]]+)\]\s*\)/g;
  const matches = [...content.matchAll(tableAssignRe)];

  for (const m of matches) {
    const tableVar = m[1];
    const items = m[2].split(",").map((s) => s.trim()).filter(Boolean);

    // Cada item é um identifier referenciando uma `TableRow([...])`. Tenta
    // resolver cada um pelo escopo da resposta.
    const rows: string[][] = [];
    const cols: string[] = [];
    let isHeader = true;

    for (const ref of items) {
      const rowDefRe = new RegExp(
        `\\b${ref}\\s*=\\s*TableRow\\(\\s*\\[([\\s\\S]+?)\\]\\s*\\)`,
      );
      const rd = content.match(rowDefRe);
      if (!rd) {
        // Não encontrou definição da row — pula
        continue;
      }
      const cellsRaw = rd[1];
      // Captura todos os `TableHeader('X')` / `TableCell('X')` valores
      const cellRe = /\b(?:TableHeader|TableCell)\s*\(\s*['"]([^'"]*)['"]\s*\)/g;
      const cells: string[] = [];
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(cellsRaw)) !== null) {
        cells.push(cm[1]);
      }
      if (cells.length === 0) continue;

      if (isHeader && /TableHeader\s*\(/.test(cellsRaw)) {
        cols.push(...cells);
        isHeader = false;
      } else {
        rows.push(cells);
        isHeader = false;
      }
    }

    if (cols.length === 0 || rows.length === 0) continue;

    // Gera sintaxe canônica
    const colDefs = cols
      .map((c, i) => `col${i + 1} = Col(header='${escapeSingleQ(c)}')`)
      .join("\n");
    const colRefs = cols.map((_c, i) => `col${i + 1}`).join(", ");
    const rowsLiteral = rows
      .map(
        (row) =>
          `    [${row.map((v) => `'${escapeSingleQ(v)}'`).join(", ")}]`,
      )
      .join(",\n");

    const newTable =
      `${tableVar} = Table(\n  columns=[${colRefs}],\n  rows=[\n${rowsLiteral}\n  ]\n)\n${colDefs}`;

    // Substitui o Table legado + remove as defs `r1 = TableRow(...)` antigas
    content = content.replace(m[0], newTable);
    for (const ref of items) {
      const rowDefRe = new RegExp(
        `\\b${ref}\\s*=\\s*TableRow\\([\\s\\S]+?\\)\\s*\\n?`,
        "g",
      );
      content = content.replace(rowDefRe, "");
    }
    rewrites++;
  }

  return { content, rewrites };
}

function escapeSingleQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function extractWorkflowIdFromToolCalls(
  calls: Array<{ name: string; arguments: string }>,
): number | undefined {
  const workflowTools = new Set([
    "get_workflow",
    "get_workflow_kanban",
    "get_workflow_tasks",
    "get_workflow_statistics",
  ]);

  for (const call of calls) {
    if (!workflowTools.has(call.name)) continue;
    try {
      const args = JSON.parse(call.arguments) as { workflow_id?: number };
      if (typeof args.workflow_id === "number") return args.workflow_id;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}
