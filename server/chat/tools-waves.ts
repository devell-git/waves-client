/**
 * Definições de tools Waves (schemas OpenAI + executors Codex).
 *
 * Extraído de server/chat.ts (split fatia 5).
 */
import {
  toolsToResponsesFormat,
  type CodexTool,
} from "../codex-client.js";
import {
  getAssistantFunnel,
  getBookingAvailableDates,
  getBookingAvailableSlots,
  getTask,
  getWorkflow,
  getWorkflowKanban,
  getWorkflowStatistics,
  getWorkflowTasks,
  listAppointments,
  listWorkflows,
  type WavesSession,
  type WorkflowStatisticsMetric,
} from "../waves-client.js";

/**
 * Schemas das tools (sem function executor) — usado pelo Codex (Responses API).
 * O loop multi-turno chama os executors separadamente.
 */
export function createCodexToolsAndExecutors(session: WavesSession): {
  tools: CodexTool[];
  executors: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  return {
    tools: toolsToResponsesFormat(createTools(session)),
    executors: {
      list_workflows: async () => await listWorkflows(session),
      get_workflow: async ({ workflow_id }) =>
        await getWorkflow(session, Number(workflow_id)),
      get_workflow_kanban: async ({ workflow_id }) =>
        await getWorkflowKanban(session, Number(workflow_id)),
      get_workflow_tasks: async ({ workflow_id, funnel_stage_id, status, overdue }) =>
        await getWorkflowTasks(session, Number(workflow_id), {
          funnel_stage_id: funnel_stage_id as number | undefined,
          status: status as string | undefined,
          overdue: overdue as boolean | undefined,
        }),
      get_workflow_statistics: async ({ workflow_id, metric, days }) =>
        await getWorkflowStatistics(
          session,
          Number(workflow_id),
          metric as WorkflowStatisticsMetric,
          (days as number | undefined) ?? 30,
        ),
      get_task: async ({ task_id }) =>
        await getTask(session, Number(task_id)),
      list_appointments: async ({ booking_id, start_date, end_date, status }) =>
        await listAppointments(session, Number(booking_id), {
          start_date: start_date as string | undefined,
          end_date: end_date as string | undefined,
          status: status as string | undefined,
        }),
      get_booking_available_dates: async ({ booking_id, start_date, end_date }) =>
        await getBookingAvailableDates(
          session,
          Number(booking_id),
          start_date as string | undefined,
          end_date as string | undefined,
        ),
      get_booking_available_slots: async ({ booking_id, date }) =>
        await getBookingAvailableSlots(session, Number(booking_id), String(date)),
      get_assistant_funnel: async ({ assistant_id }) =>
        await getAssistantFunnel(session, Number(assistant_id)),
    },
  };
}

export function createTools(session: WavesSession) {
  return [
    {
      type: "function" as const,
      function: {
        name: "list_workflows",
        description:
          "Returns JSON with workflows visible to the user. Use data for Table, ListBlock, or workflow pickers in openui-lang.",
        parameters: { type: "object", properties: {}, required: [] },
        function: async () => JSON.stringify(await listWorkflows(session)),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_workflow",
        description:
          "Returns JSON metadata for one workflow. Use for CardHeader, TextContent, TagBlock in openui-lang.",
        parameters: {
          type: "object",
          properties: {
            workflow_id: { type: "number", description: "Workflow ID" },
          },
          required: ["workflow_id"],
        },
        function: async ({ workflow_id }: { workflow_id: number }) =>
          JSON.stringify(await getWorkflow(session, workflow_id)),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_workflow_kanban",
        description:
          "Returns JSON kanban board (stages/columns and tasks). Preferred for Tabs/TabItem kanban UI — map each stage to a tab and tasks to Table or nested Cards.",
        parameters: {
          type: "object",
          properties: {
            workflow_id: { type: "number", description: "Workflow ID" },
          },
          required: ["workflow_id"],
        },
        function: async ({ workflow_id }: { workflow_id: number }) =>
          JSON.stringify(await getWorkflowKanban(session, workflow_id)),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_workflow_tasks",
        description:
          "Returns JSON task list for a workflow. Use when kanban is unavailable; group by stage name for Tabs. Optional filters.",
        parameters: {
          type: "object",
          properties: {
            workflow_id: { type: "number", description: "Workflow ID" },
            funnel_stage_id: { type: "number", description: "Filter by stage ID" },
            status: {
              type: "string",
              description: "e.g. in_progress, todo, done",
            },
            overdue: { type: "boolean", description: "Only overdue tasks" },
          },
          required: ["workflow_id"],
        },
        function: async ({
          workflow_id,
          funnel_stage_id,
          status,
          overdue,
        }: {
          workflow_id: number;
          funnel_stage_id?: number;
          status?: string;
          overdue?: boolean;
        }) =>
          JSON.stringify(
            await getWorkflowTasks(session, workflow_id, {
              funnel_stage_id,
              status,
              overdue,
            }),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_workflow_statistics",
        description:
          "Returns JSON statistics for dashboards: overview (KPIs), by-stage (PieChart/BarChart), by-user, by-task-type, timeline.",
        parameters: {
          type: "object",
          properties: {
            workflow_id: { type: "number", description: "Workflow ID" },
            metric: {
              type: "string",
              enum: ["overview", "by-stage", "by-user", "by-task-type", "timeline"],
              description: "Which statistics endpoint to call",
            },
            days: {
              type: "number",
              description: "For timeline only (default 30)",
            },
          },
          required: ["workflow_id", "metric"],
        },
        function: async ({
          workflow_id,
          metric,
          days,
        }: {
          workflow_id: number;
          metric: WorkflowStatisticsMetric;
          days?: number;
        }) =>
          JSON.stringify(
            await getWorkflowStatistics(session, workflow_id, metric, days ?? 30),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_task",
        description:
          "Returns JSON for one task (title, stage, checklist, assignee). Use for detail Card + ListBlock checklist.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "number", description: "Task ID" },
          },
          required: ["task_id"],
        },
        function: async ({ task_id }: { task_id: number }) =>
          JSON.stringify(await getTask(session, task_id)),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "list_appointments",
        description:
          "Lista agendamentos (appointments) marcados numa agenda específica em um período. Cada appointment tem 'json' com os dados do formulário (nome paciente, telefone). Use pra responder 'agendamentos da próxima semana', 'quem agendou para amanhã', 'consultas marcadas em X'.",
        parameters: {
          type: "object",
          properties: {
            booking_id: { type: "number", description: "ID da agenda (booking)" },
            start_date: { type: "string", description: "Data inicial ISO YYYY-MM-DD (opcional)" },
            end_date: { type: "string", description: "Data final ISO YYYY-MM-DD (opcional)" },
            status: { type: "string", description: "Filtro de status (pending, confirmed, cancelled — opcional)" },
          },
          required: ["booking_id"],
        },
        function: async ({
          booking_id,
          start_date,
          end_date,
          status,
        }: {
          booking_id: number;
          start_date?: string;
          end_date?: string;
          status?: string;
        }) =>
          JSON.stringify(
            await listAppointments(session, booking_id, {
              start_date,
              end_date,
              status,
            }),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_booking_available_dates",
        description:
          "Datas que ainda têm slots disponíveis numa agenda dentro de um período. Use pra 'quando posso marcar', 'datas disponíveis em junho', 'dias livres'.",
        parameters: {
          type: "object",
          properties: {
            booking_id: { type: "number", description: "ID da agenda" },
            start_date: { type: "string", description: "Data inicial YYYY-MM-DD (opcional)" },
            end_date: { type: "string", description: "Data final YYYY-MM-DD (opcional)" },
          },
          required: ["booking_id"],
        },
        function: async ({
          booking_id,
          start_date,
          end_date,
        }: {
          booking_id: number;
          start_date?: string;
          end_date?: string;
        }) =>
          JSON.stringify(
            await getBookingAvailableDates(session, booking_id, start_date, end_date),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_booking_available_slots",
        description:
          "Horários (slots) disponíveis numa agenda em UM dia específico. Use pra 'que horários tem em 2026-06-04', 'slots de hoje', etc.",
        parameters: {
          type: "object",
          properties: {
            booking_id: { type: "number", description: "ID da agenda" },
            date: { type: "string", description: "Data alvo YYYY-MM-DD" },
          },
          required: ["booking_id", "date"],
        },
        function: async ({
          booking_id,
          date,
        }: {
          booking_id: number;
          date: string;
        }) =>
          JSON.stringify(
            await getBookingAvailableSlots(session, booking_id, date),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_assistant_funnel",
        description:
          "Retorna o funil (funnel) de captação associado a um assistant, com suas stages (id, nome, cor, ordem, parent, has_form). Use quando o user pedir detalhes de um funil, stages de um assistant, ou para renderizar pipeline visual. O contexto da sessão já lista os funis disponíveis com IDs.",
        parameters: {
          type: "object",
          properties: {
            assistant_id: {
              type: "number",
              description: "ID do assistant dono do funil",
            },
          },
          required: ["assistant_id"],
        },
        function: async ({ assistant_id }: { assistant_id: number }) =>
          JSON.stringify(await getAssistantFunnel(session, assistant_id)),
        parse: JSON.parse,
      },
    },
  ];
}
