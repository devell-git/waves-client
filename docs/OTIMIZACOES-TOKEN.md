# Otimizações de Token e Velocidade — waves_client

Registro das melhorias de **economia de token** e **velocidade de resposta** no
waves_client (chat generative-UI sobre o Hermes). Vivo — adicionar conforme
implementa.

> **Diagnóstico-raiz:** o Hermes guarda os resultados de tool na **sessão** e os
> **reenvia ao modelo a CADA turno**. Cada tool de leitura pesada (kanban 35k,
> list_workflows 21k, statistics, etc.) vira custo recorrente. Threads chegaram a
> **298k → 568k → 1M tokens/turno**. O eixo de todas as otimizações: **tirar a
> busca de dados da sessão do LLM e levar pro RUNTIME (navegador) via dual-flow**.

---

## 1. Dual-flow OpenUI — kanban/tasks via Query (runtime), não via tool
- **O quê:** o agente emite `Query("get_workflow_kanban", {id})` + `WorkflowKanban`
  (e `Query("list_tasks", …)` + `TaskList`). O **runtime** (toolProvider,
  `src/lib/openui-tools.ts`) busca client-side; nada entra na sessão.
- **Impacto:** kanban **35k → ~1.3k tok** por chamada; list_tasks **10k → 0** na sessão.
- **Arquivos:** `openui-tools.ts`, `components/workflow-kanban.tsx`, `components/task-list.tsx`.

## 2. Queries de Agregação (runtime) — overview e por-responsável
- **Problema:** não há endpoint global na Waves (`list_tasks` exige `workflow_id`;
  `statistics/overview` é por workflow). Contar "tasks em atraso" / "tasks do
  Fabricio" obrigava iterar ~41 APs → 34 tool calls / **22k tok** (ou 429).
- **O quê:** tools sintéticas no runtime que iteram os workflows **no navegador**
  (concorrência limitada + cache):
  - `get_project_overview` → soma `statistics/overview` de todos os APs → `ProjectOverview`.
  - `get_tasks_by_responsible` → itera `list_tasks` + filtra por nome → `TaskList`.
- **Impacto:** "quantas tasks em atraso" **34 tools / 22k tok → 0 tools / ~142 tok**.
- **Arquivos:** `openui-tools.ts` (sintéticas), `components/project-overview.tsx`.

## 3. Filtro por responsável client-side (sem `responsible_id`)
- **Bug:** a task expõe o responsável como **string** ("KC Soares"), não id. Filtrar
  por `responsible_id` (que o agente não resolve) dava "Nenhuma task" (eram 30).
- **O quê:** `TaskList` lê responsável string-ou-objeto e **filtra por nome**
  (3º arg). Prompt proíbe `responsible_id`.
- **Arquivos:** `components/task-list.tsx`, `server/waves-prompt.ts`.

## 4. Hardening anti-429 no runtime
- **O quê:** todo fetch de agregação faz **retry com backoff** (respeita
  `Retry-After`) e roda com **concorrência 3** (era 5). Evita/contorna o
  rate-limit da Waves ao iterar dezenas de APs.
- **Arquivo:** `openui-tools.ts` (`rawGet`, `mapLimit`).

## 5. Consolidação do prompt (WAVES_ADDENDUM)
- **Contradições removidas** (causavam o bloat e as falhas):
  - Saudação "texto puro" (exemplos) **vs** "openui-lang + FollowUps" (REGRA 0) →
    o agente pulava o FollowUpBlock. **Corrigido.**
  - "Ver tasks de X: **filtre o JSON** retornado" **vs** "PROIBIDO chamar a tool"
    → essa linha **autorizava** o tool-call que inflava a sessão. **Removida.**
- **Redundância** fundida: FollowUpBlock dito 3×, "enxuto" 3×.
- **Refs obsoletos** (Sonnet 50-80 tok/s, Opus 4.7) → genéricos. Modelo é gpt-5.4.
- **Impacto:** o agente passou a usar Query em vez da tool (bloat de tasks → 0).

## 6. Reforço de FollowUpBlock (sugestões)
- **Problema:** gpt-5.4 respondia em **texto puro** com bullets de markdown em vez de
  `FollowUpBlock` (chips clicáveis) → "não gera sugestões".
- **O quê:** REGRA 0 reescrita com exemplo contrastivo ❌/✅ e proibição de bullet
  de texto como sugestão. **Verificado:** voltou a gerar chips.

## 7. Truncamento de resultado por origem (plugin Hermes) — ✅ DEPLOYADO
- **O quê:** hook `transform_tool_result` no plugin `bioshield-scope` ENCOLHE o
  resultado das tools de leitura pesadas **só no waves_client** (origem por
  session_id): `list_workflows` → só `id+nome`; kanban/tasks → stub
  ("renderizado via runtime"). Telegram recebe completo.
- **Por quê:** o gpt-5.4 às vezes chama a tool MCP em vez do Query (os 2 MCPs
  `bioshield`/`waves-openui` duplicam o runtime). `list_workflows` sozinho =
  **235k tok acumulados**. O truncamento mata o bloat sem cegar o agente
  (mantém id+nome) e sem quebrar Telegram.
- **Bônus:** corrigiu de quebra um **bug de segurança** — a mudança de
  multi-tenant (`waves-<tenant>-user-<id>::`) tinha quebrado a regex de escopo
  por usuário (`^waves-user-` não casava) → o filtro por usuário parou de
  funcionar no waves_client. Regex corrigida pra casar tenant + legado.
- **Arquivo:** `~/.hermes/profiles/bioshield-steve/plugins/bioshield-scope/__init__.py`.
- **Detalhe técnico:** o resultado das MCP tools vem **duplo-encodado**
  (`{"result": "<json-string>"}`) — o `_deep_parse` lida com isso. O hook
  `transform_tool_result` dispara no `model_tools.py`.
- **Verificado:** `list_workflows` **21.223ch → 2.649ch** (~88% de corte).
- **Status:** ✅ **DEPLOYADO** (restart do Steve 2026-06-02), testado, log limpo.

## 8. Token usage admin + auditoria
- `/api/chat` emite marcador `<!--waves-usage:{p,c,t}-->` só pra admin
  (`wantUsage`), exibido no badge. Log `[chat:usage]` no servidor pra auditar
  qualquer thread (`journalctl --user -u waves-client -f | grep chat:usage`).

## 9. Outros
- **scopeContext** com caps reduzidos (workflows 30→15, assistants/bookings 25→12).
- **`/api/profiles` e `/api/tenant` com `no-store`** — refetch no reload.
- **Contexto do login** não afirma mais "0 (user não tem nenhum)" falsamente —
  manda buscar sob demanda (correção, não token, mas evita resposta errada).

---

## Aprendizados / decisões
- **Skills = +1 turno LLM cada.** A resposta "compare APs" invocava 5 skills →
  98s/193k. **Proibir no prompt** as skills de dados derrubou pra 11s/34k.
- **Bloquear skill no plugin NÃO funciona:** o agente flaila quando negado
  (tenta outros caminhos → +turnos → PIOR, 30s→35s). Ficou só a proibição de
  prompt. Resíduo: o `list_wf` ainda consulta `listar` às vezes (aceitável).
- **`get_workflow` NÃO é truncado** (só list_workflows/kanban/tasks) — fidelidade
  de metadados > economia; o agente pode precisar do template/funil do AP.

## Pendências (próximos alvos de economia)
- [x] ~~Proibir skills de dados no prompt~~ — feito (98s→11s).
- [ ] Skill `waves-task-counting` / `visao-de-progresso` residual no
      waves_client (o runtime já cobre) — ainda são chamadas (6–9k cada).
- [ ] Avaliar remover/desligar 1 dos 2 MCPs Waves duplicados (`bioshield` vs
      `waves-openui`) — risco: SOUL/Telegram referenciam.
- [ ] Enxugar o piso (~32k): SOUL+skills (~20k Hermes) + lib shadcn (~13k).
- [ ] Componente de runtime pro picker de workflow (resolver AP→id sem `list_workflows`).

## Métricas de referência
| Cenário | Antes | Depois |
|---|---|---|
| Kanban (chamada) | ~35k tok na sessão | ~1.3k (runtime) |
| "tasks em atraso" | 34 tools / 22k tok | 0 tools / ~142 tok |
| "tasks da KC Soares" | "Nenhuma task" (bug) | filtra por nome, 0 bloat |
| Thread novo (piso) | — | ~32k (SOUL+skills+prompt) |
