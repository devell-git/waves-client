import type { ChatRequestBody } from "./types.js";

/**
 * Monta bloco de texto com o escopo do user pra injetar no system prompt.
 * Agente lê isso e responde perguntas básicas sem precisar chamar list_workflows
 * etc. Ainda pode chamar tools pra detalhes (kanban, statistics, task individual).
 */
export function buildScopeContext(body: ChatRequestBody): string {
  const lines: string[] = [];
  const scope = body.userScope ?? null;
  const u = body.user;

  // Data atual em ISO + dia da semana — agente precisa pra resolver "próxima
  // semana", "amanhã", etc, ao calcular ranges pra list_appointments.
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("pt-BR", { weekday: "long" });

  lines.push("");
  lines.push("---");
  lines.push("## Contexto do usuário (carregado no login)");
  lines.push("");
  lines.push(`**Data atual:** ${todayIso} (${weekday})`);
  lines.push("");

  if (u) {
    const userBits = [
      u.name && `**${u.name}**`,
      u.email && `\`${u.email}\``,
      u.id != null && `id=${u.id}`,
      u.type && `type=${u.type}`,
    ].filter(Boolean);
    if (userBits.length) lines.push(`**Usuário:** ${userBits.join(" · ")}`);
  }

  if (body.roles && body.roles.length) {
    lines.push(`**Roles:** ${body.roles.join(", ")}`);
  }
  if (body.persona) {
    lines.push(`**Persona inferida:** ${body.persona}`);
  }

  if (body.permissions && body.permissions.length) {
    const perms = body.permissions;
    const preview = perms.slice(0, 15).join(", ");
    const more = perms.length > 15 ? ` (+${perms.length - 15} outras)` : "";
    lines.push(`**Permissões (${perms.length}):** ${preview}${more}`);
  }

  if (scope) {
    // Workflows
    if (scope.workflows && scope.workflows.length) {
      lines.push("");
      lines.push(`**Workflows visíveis (${scope.workflows.length}):**`);
      const max = 15;
      for (const w of scope.workflows.slice(0, max)) {
        const label = w.name ?? w.title ?? `(sem nome)`;
        lines.push(`- \`${w.id}\` — ${label}`);
      }
      if (scope.workflows.length > max) {
        lines.push(`- … (+${scope.workflows.length - max} workflows não listados)`);
      }
      if (scope.defaultWorkflowId != null) {
        lines.push(`(workflow padrão: \`${scope.defaultWorkflowId}\`)`);
      }
    } else {
      lines.push("");
      lines.push(
        "**Workflows:** inventário NÃO pré-carregado no login (otimização). " +
          "NÃO afirme que o usuário tem 0 — use `list_workflows` (ou Query no " +
          "runtime) pra listar quando precisar.",
      );
    }

    // Assistants
    if (scope.assistants && scope.assistants.length) {
      lines.push("");
      lines.push(`**Assistentes visíveis (${scope.assistants.length}):**`);
      const max = 12;
      for (const a of scope.assistants.slice(0, max)) {
        const label = a.name ?? a.title ?? `(sem nome)`;
        lines.push(`- \`${a.id}\` — ${label}`);
      }
      if (scope.assistants.length > max) {
        lines.push(`- … (+${scope.assistants.length - max} assistentes não listados)`);
      }
    } else {
      lines.push("");
      lines.push(
        "**Assistentes:** inventário NÃO pré-carregado no login (otimização). " +
          "NÃO afirme que o usuário tem 0 — use `list_assistants` pra listar " +
          "quando precisar.",
      );
    }

    // Bookings
    if (scope.bookings && scope.bookings.length) {
      lines.push("");
      lines.push(`**Agendas visíveis (${scope.bookings.length}):**`);
      const max = 12;
      for (const b of scope.bookings.slice(0, max)) {
        const label = b.booking_name ?? b.name ?? b.title ?? `(sem nome)`;
        lines.push(`- \`${b.id}\` — ${label}`);
      }
      if (scope.bookings.length > max) {
        lines.push(`- … (+${scope.bookings.length - max} agendas não listadas)`);
      }
    } else {
      lines.push("");
      lines.push(
        "**Agendas:** inventário NÃO pré-carregado no login (otimização). " +
          "NÃO afirme que o usuário tem 0 — busque sob demanda quando precisar.",
      );
    }

    // Funnels (1 por assistant; lista nome + stages slim no contexto)
    if (scope.funnels && scope.funnels.length) {
      lines.push("");
      lines.push(`**Funis visíveis (${scope.funnels.length}):**`);
      const max = 8;
      for (const f of scope.funnels.slice(0, max)) {
        const stageBits = (f.stages ?? [])
          .filter((s) => !s.hidden)
          .map((s) => s.name)
          .filter(Boolean)
          .slice(0, 8)
          .join(" → ");
        const more =
          f.stages_count != null && f.stages_count > 8
            ? ` (+${f.stages_count - 8})`
            : "";
        const label = f.name ?? `Funil ${f.id}`;
        lines.push(
          `- \`${f.id}\` — ${label} · assistant=\`${f.assistant_id}\` · ${f.stages_count ?? f.stages?.length ?? 0} stages` +
            (stageBits ? `: ${stageBits}${more}` : ""),
        );
      }
      if (scope.funnels.length > max) {
        lines.push(`- … (+${scope.funnels.length - max} funis não listados)`);
      }
    } else {
      lines.push("");
      lines.push(
        "**Funis/estágios:** NÃO pré-carregados no login. NÃO afirme que o " +
          "usuário tem 0 — o estágio de cada AP vem de `get_workflow_kanban` / " +
          "`list_tasks` (ou Query no runtime), não do scope.",
      );
    }
  }

  lines.push("");
  lines.push(
    "**Como usar:** pra perguntas básicas (quantos/quais workflows/assistentes/agendas/funis), responda direto desse contexto. " +
      "Use tools (`get_workflow_kanban`, `get_workflow_tasks`, `get_workflow_statistics`, `get_task`, `get_assistant_funnel`) só pra detalhes que não estão acima.",
  );
  lines.push("---");
  lines.push("");

  return lines.join("\n");
}
