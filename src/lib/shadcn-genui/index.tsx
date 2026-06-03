"use client";

import type { ComponentGroup, PromptOptions } from "@openuidev/react-lang";
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

import { Card, CardContent } from "@/components/ui/card";

// Content
import { Alert } from "./components/alert";
import { Avatar } from "./components/avatar";
import { ShadcnBadgeComponent } from "./components/badge";
import { CardHeader } from "./components/card-header";
import { CodeBlock } from "./components/code-block";
import { Image, ImageBlock } from "./components/image";
import { FileDownload } from "./components/file-download";
import { MarkDownRenderer } from "./components/markdown-renderer";
import { Progress } from "./components/progress";
import { Separator } from "./components/separator";
import { TextContent } from "./components/text-content";

// Charts
import {
  AreaChartCondensed,
  BarChartCondensed,
  LineChartCondensed,
  PieChartComponent,
  Point,
  RadarChartComponent,
  RadialChartComponent,
  ScatterChartComponent,
  ScatterSeries,
  Series,
  Slice,
} from "./components/charts";

// Forms
import { CheckBoxGroup, CheckBoxItem } from "./components/checkbox-group";
import { DatePicker } from "./components/date-picker";
import { Form } from "./components/form";
import { FormControl } from "./components/form-control";
import { Input } from "./components/input";
import { Label } from "./components/label";
import { RadioGroup, RadioItem } from "./components/radio-group";
import { Select, SelectItem } from "./components/select";
import { Slider } from "./components/slider";
import { SwitchGroup, SwitchItem } from "./components/switch-group";
import { TextArea } from "./components/textarea";

// Buttons
import { Button } from "./components/button";
import { Buttons } from "./components/buttons";

// Layout
import { Accordion, AccordionItemDef } from "./components/accordion";
import { Carousel } from "./components/carousel";
import { TabItem, Tabs } from "./components/tabs";

// Data Display
import { Col, Table } from "./components/table";
import { Tag, TagBlock } from "./components/tag";

// Chat-specific
import { FollowUpBlock, FollowUpItem } from "./components/follow-up-block";

// New components
import { AlertDialogBlock } from "./components/alert-dialog-block";
import { CalendarBlock } from "./components/calendar-block";
import { DialogBlock } from "./components/dialog-block";
import { DrawerBlock } from "./components/drawer-block";
import { PaginationBlock } from "./components/pagination-block";
import { Blockquote, Heading, InlineCode } from "./components/typography";
// Layout container flexível (kanban, dashboards multi-coluna). Adicionado
// para suportar pedidos como "monte um kanban com 4 colunas".
import { Stack } from "./components/stack";

// Kanban dedicado (board horizontal estilo Trello) — preferir vs Stack(horizontal)
// quando pedido for "kanban", "board", "agrupar por stage".
import { Kanban, KanbanCard, KanbanColumn } from "./components/kanban";
import { WorkflowKanban } from "./components/workflow-kanban";
import { WorkflowGantt } from "./components/workflow-gantt";
import { ScheduleHealthReport } from "./components/schedule-health-report";
import { PendingCriticalReport } from "./components/pending-critical-report";
import { ResponsibilityLoadReport } from "./components/responsibility-load-report";
import { TaskList } from "./components/task-list";
import { ProjectOverview } from "./components/project-overview";

// Collapsible — bloco único colapsável (não confundir com Accordion, que é
// lista de seções). Usar para "ver mais", "detalhes", "notas avançadas".
import { Collapsible } from "./components/collapsible";

// List/ListItem — lista vertical com marcadores (bullet/number/check) e
// itens opcionalmente expansíveis. Steps/StepsItem — sequência ordenada
// estilo wizard com indicadores numerados e status (pending/in_progress/
// completed/blocked).
import { List, ListItem } from "./components/list";
import { Steps, StepsItem } from "./components/steps";

import { ChatContentChildUnion } from "./unions";

const ChatCardChildUnion = z.union([
  ...ChatContentChildUnion.options,
  Tabs.ref,
  Carousel.ref,
  Stack.ref,
  Kanban.ref,
  WorkflowKanban.ref,
  WorkflowGantt.ref,
  ScheduleHealthReport.ref,
  PendingCriticalReport.ref,
  ResponsibilityLoadReport.ref,
  Collapsible.ref,
  List.ref,
  Steps.ref,
]);

const ChatCard = defineComponent({
  name: "Card",
  props: z.object({
    children: z.array(ChatCardChildUnion),
  }),
  description:
    "Vertical container for all content in a chat response. Children stack top to bottom automatically.",
  component: ({ props, renderNode }) => (
    <Card>
      <CardContent className="p-0 space-y-3">{renderNode(props.children)}</CardContent>
    </Card>
  ),
});

// ── Component Groups ──

export const shadcnComponentGroups: ComponentGroup[] = [
  {
    name: "Content",
    components: [
      "CardHeader",
      "TextContent",
      "MarkDownRenderer",
      "Alert",
      "Badge",
      "Avatar",
      "CodeBlock",
      "Image",
      "ImageBlock",
      "FileDownload",
      "Progress",
      "Separator",
    ],
    notes: [
      "- Image/ImageBlock mostram imagem inline (src = URL pública ou data:image/...;base64).",
      "- FileDownload(id, filename, mimeType?, size?) oferece um arquivo pro usuário BAIXAR (relatório, export). id = uuid do arquivo registrado no servidor (agent-files). NÃO invente o id — use o retornado ao registrar o arquivo.",
    ],
  },
  {
    name: "Tables",
    components: ["Table", "Col"],
  },
  {
    name: "Charts (2D)",
    components: ["BarChart", "LineChart", "AreaChart", "RadarChart", "Series"],
  },
  {
    name: "Charts (1D)",
    components: ["PieChart", "RadialChart", "Slice"],
  },
  {
    name: "Charts (Scatter)",
    components: ["ScatterChart", "ScatterSeries", "Point"],
  },
  {
    name: "Forms",
    components: [
      "Form",
      "FormControl",
      "Label",
      "Input",
      "TextArea",
      "Select",
      "SelectItem",
      "DatePicker",
      "Slider",
      "CheckBoxGroup",
      "CheckBoxItem",
      "RadioGroup",
      "RadioItem",
      "SwitchGroup",
      "SwitchItem",
    ],
    notes: [
      "- Define EACH FormControl as its own reference — do NOT inline all controls in one array.",
      "- NEVER nest Form inside Form.",
      "- Form requires explicit buttons. Always pass a Buttons(...) reference as the third Form argument.",
      "- rules is an optional object: { required: true, email: true, min: 8, maxLength: 100 }",
      "- The renderer shows error messages automatically — do NOT generate error text in the UI",
    ],
  },
  {
    name: "Buttons",
    components: ["Button", "Buttons"],
  },
  {
    name: "Follow-ups",
    components: ["FollowUpBlock", "FollowUpItem"],
    notes: [
      "- Use FollowUpBlock with FollowUpItem references at the end of a response to suggest next actions.",
      "- Clicking a FollowUpItem sends its text to the LLM as a user message.",
    ],
  },
  {
    name: "Layout",
    components: ["Tabs", "TabItem", "Accordion", "AccordionItem", "Carousel"],
    notes: [
      "- Use Tabs to present alternative views — each TabItem has a value id, trigger label, and content array.",
      "- Carousel takes an array of slides, where each slide is an array of content.",
      "- IMPORTANT: Every slide in a Carousel must have the same structure.",
    ],
  },
  {
    name: "Data Display",
    components: ["TagBlock", "Tag"],
  },
  {
    name: "Typography",
    components: ["Heading", "Blockquote", "InlineCode"],
    notes: [
      '- Heading levels: "h1" | "h2" | "h3" | "h4". Each renders with appropriate shadcn/ui typography styles.',
      "- Blockquote for styled quotes with optional cite attribution.",
      "- InlineCode for monospace code snippets within text.",
    ],
  },
  {
    name: "Calendar",
    components: ["CalendarBlock"],
    notes: [
      '- CalendarBlock renders a standalone interactive calendar. mode: "single" | "multiple" | "range".',
      "- Use numberOfMonths to show multiple months side by side.",
      "- Use defaultMonth (ISO date string) to set the initial visible month.",
    ],
  },
  {
    name: "Navigation",
    components: ["PaginationBlock"],
    notes: ["- PaginationBlock takes currentPage and totalPages."],
  },
  {
    name: "Overlays",
    components: ["DialogBlock", "AlertDialogBlock", "DrawerBlock"],
    notes: [
      "- DialogBlock renders a button that opens a modal dialog with content inside.",
      "- AlertDialogBlock renders a confirmation dialog with cancel/confirm actions.",
      "- DrawerBlock renders a bottom drawer panel triggered by a button.",
    ],
  },
  {
    name: "Layout (multi-column)",
    components: ["Stack"],
    notes: [
      '- Stack(children, direction?, gap?, alignX?, alignY?) — flexible layout container.',
      '- direction: "column" (default) for vertical, "row" for horizontal (use for kanban columns, side-by-side cards).',
      '- gap: "none" | "xs" | "s" | "m" (default) | "l" | "xl".',
      '- alignX (main axis justify): "start" | "center" | "end" | "stretch" | "between".',
      '- alignY (cross axis): "start" | "center" | "end" | "stretch".',
      '- Use Stack as root when you need multi-column layouts (kanban, dashboard grids).',
      "- Nest Card inside Stack and Stack inside Card freely.",
    ],
  },
  {
    name: "Kanban / Lista de tasks / Visão agregada (data-driven via Query)",
    components: ["WorkflowKanban", "WorkflowGantt", "ScheduleHealthReport", "PendingCriticalReport", "ResponsibilityLoadReport", "TaskList", "ProjectOverview"],
    notes: [
      '- 🔑 KANBAN de workflow: SEMPRE `kb = Query("get_workflow_kanban", {id: <workflow_id>}, {stages: []})` + `board = WorkflowKanban(kb)`. NADA MAIS. O RUNTIME busca; o componente monta colunas/cards/drag/edição/"+ Nova".',
      '- 🔑 CRONOGRAMA / linha do tempo / Gantt de um AP: SEMPRE `g = Query("get_workflow_gantt", {workflow_id: <id>}, {rows: []})` + `gantt = WorkflowGantt(g)`. O RUNTIME lista as tasks e hidrata as datas (start_date→due_date); tarefa sem prazo vira marco. NÃO monte barras à mão nem chame tools de data.',
      '- 🔑 SAÚDE DO CRONOGRAMA / avanço esperado vs real / desvio de um AP: SEMPRE `h = Query("get_schedule_health", {workflow_id: <id>}, {rows: []})` + `rep = ScheduleHealthReport(h)`. O RUNTIME compara % esperado (tempo decorrido) vs % real (progress), classifica saúde e monta cards + leitura executiva + tabela. NÃO calcule você mesmo nem monte a tabela à mão.',
      '- 🔑 PENDÊNCIAS CRÍTICAS / bloqueios / "o que está travado" de um AP: SEMPRE `p = Query("get_pending_critical", {workflow_id: <id>}, {rows: []})` + `rep = PendingCriticalReport(p)`. O RUNTIME filtra vencidas/sem responsável/sem prazo/paradas/aguardando dependência e monta cards + leitura executiva + tabela acionável. NÃO filtre você mesmo nem monte a tabela à mão.',
      '- 🔑 CARGA / RESPONSABILIDADE / distribuição por responsável de um AP: SEMPRE `c = Query("get_responsibility_load", {workflow_id: <id>}, {rows: []})` + `rep = ResponsibilityLoadReport(c)`. O RUNTIME agrupa por pessoa (total/seguras/atenção/críticas/vencendo em 7d/% médio/risco/observação). NÃO agrupe você mesmo nem monte a tabela à mão.',
      '- 🔑 ANÁLISE APROFUNDADA / completa / "mais profunda" de um AP (não um relatório só): componha um `Card` com `Tabs` dos relatórios relevantes — cada aba um `Query(...) + <Report>` (PendingCriticalReport + ScheduleHealthReport + ResponsibilityLoadReport) — MAIS uma "Decisão executiva sugerida" (`TextContent` interpretativo) e "Prioridade de ação" (`Steps` de 3 itens), e feche com followUps "Gerar PDF do relatório" (download no chat) E "Publicar na Waves" (cria o documento OFICIAL na plataforma via skill manage-documents → POST /api/documents). Os relatórios JÁ trazem cards, leitura executiva descritiva E gráfico de distribuição — você adiciona a leitura/decisão de governança por cima, NÃO recalcula nem refaz tabela/gráfico.',
      '- 🔑 LISTAR/FILTRAR tasks: SEMPRE `t = Query("list_tasks", {workflow_id: <id>, funnel_stage_id?, responsible_id?, search?}, {rows: []})` + `lista = TaskList(t)`. O runtime busca; o componente lista com clique→editar. Filtro: passe nos args da Query (ex.: responsible_id: $resp) → re-busca sozinho, sem LLM.',
      '- 🔑 AGREGADO do projeto (tasks em atraso / status geral / overview / "quantos em atraso"): SEMPRE `ov = Query("get_project_overview", {}, {totals: {}, rows: []})` + `vis = ProjectOverview(ov)`. O RUNTIME soma statistics/overview de TODOS os workflows (client-side). **NÃO** itere os APs nem chame statistics/overview por workflow você mesmo — era isso que gerava 34 tool calls / 22k tokens na sessão.',
      "- NÃO chame as tools de dados você mesmo (get_workflow_kanban/list_tasks/get_workflow_tasks/statistics) — isso gasta milhares de tokens e infla a sessão. Use Query + o componente; o runtime resolve.",
      "- workflow_id: use o do contexto (AP/kanban mencionado). Se não souber, pergunte 1 linha.",
      '- `KanbanColumn(name, color?, count?, cards=[...], stageId?)` — uma coluna com header. color: hex (#dc3545) → borda colorida do header. count: número de cards (mostrado como badge). **stageId = funnel_stage_id da etapa** — inclua SEMPRE (vem depois de cards) pra habilitar arrastar cards entre colunas (drag-and-drop move a task pra etapa onde foi solta). Mapeie de stage.id do kanban.',
      '- `KanbanCard(title, badges?, progress?, responsibleName?, responsibleAvatar?, tags?, id?, expandable?)` — card de uma task. badges: lista curta de strings (ex.: ["15d 6h"]). progress: 0-100 (vira barra). tags: chips coloridos. expandable: array de componentes que aparece embaixo do card quando o user clica (útil pra descrição, checklist, histórico, comentários).',
      "- Mapeamento ideal do `waves_openui_get_workflow_kanban`: stage.id → KanbanColumn.stageId (OBRIGATÓRIO p/ drag); stage.color → KanbanColumn.color; task.id → KanbanCard.id (OBRIGATÓRIO); task.time_in_current_stage → badges[0]; task.items_completed/items_count → progress; task.responsible.name/avatar → responsibleName/responsibleAvatar; task.task_type.name → tags[0]; task.description ou subtasks → expandable.",
      "- Kanban tem scroll horizontal nativo, alturas uniformes e overflow controlado — não precisa configurar nada.",
    ],
  },
  {
    name: "Collapsible",
    components: ["Collapsible"],
    notes: [
      '- `Collapsible(title, content, defaultOpen?)` — bloco único colapsável. title: header sempre visível; content: array de componentes que dobra/desdobra; defaultOpen: começa aberto (default false).',
      "- Use quando tiver UMA seção opcional (ex.: 'Ver detalhes', 'Notas avançadas', 'Configurações extras', descrição longa de um item).",
      "- Para LISTA de seções (FAQ, várias categorias), use `Accordion` em vez de várias `Collapsible` empilhadas.",
      "- Combine com Table.expandableRows e KanbanCard.expandable pra organizar densidade de informação.",
    ],
  },
  {
    name: "List",
    components: ["List", "ListItem"],
    notes: [
      '- `List(items, marker?, title?)` — lista vertical. marker: "bullet" (default) | "number" | "none" | "check" | "square".',
      '- `ListItem(text, subtitle?, status?, expandable?)` — item da lista. status: "done" | "todo" | "in_progress" | "blocked" | "info" (vira ícone à esquerda). expandable: componentes que aparecem ao clicar.',
      "- Use para starters, checklists, listas de riscos/decisões. Para listas tabulares prefira Table; para itens colapsáveis agrupados em categorias use Accordion.",
      '- Para checklist com status: `List(items, "check")` + cada item com `status: "done"`, `"todo"`, etc.',
    ],
  },
  {
    name: "Steps",
    components: ["Steps", "StepsItem"],
    notes: [
      '- `Steps(items, currentStep?, title?)` — sequência vertical numerada estilo wizard. items: array de StepsItem. currentStep (1-indexed) destaca etapa atual.',
      '- `StepsItem(title, details?, status?)` — uma etapa. status: "pending" | "in_progress" | "completed" | "blocked" (define cor do círculo).',
      "- Use para roteiros ordenados, plano de execução, onboarding, marcos de projeto. Para lista sem ordem use List.",
      "- Se `currentStep` for fornecido, etapas anteriores ficam 'completed' (check verde, tachado), a atual fica 'in_progress' (azul), posteriores ficam 'pending' (cinza).",
    ],
  },
];

// ── Examples ──

export const shadcnExamples: string[] = [
  `Pattern — Card + Table + FollowUps (most common chat response shape):
root = Card([h, tbl, fu])
h = CardHeader("Title")
tbl = Table([Col("A"), Col("B", "number")], [["x", 1], ["y", 2]])
fu = FollowUpBlock([FollowUpItem("Next 1"), FollowUpItem("Next 2"), FollowUpItem("Next 3")])`,

  `Pattern — Card with KPI tags + BarChart + insight (dashboard shape):
root = Card([h, kpis, chart, insight, fu])
h = CardHeader("Title", "subtitle")
kpis = TagBlock([Tag("Total: 29", "default"), Tag("+18%", "secondary")])
chart = BarChart(["Q1", "Q2"], [Series("metric", [10, 20])], "grouped", "Period", "Value")
insight = TextContent("Short takeaway.", "small")
fu = FollowUpBlock([FollowUpItem("Drill-down"), FollowUpItem("Alternative view"), FollowUpItem("Deeper")])`,

  `Pattern — Tabs for alternative views:
root = Card([h, t])
h = CardHeader("Title")
t = Tabs([t1, t2])
t1 = TabItem("revenue", "Revenue", [revChart])
t2 = TabItem("users", "Users", [usrChart])
revChart = BarChart(["Q1"], [Series("R", [10])], "grouped", "Period", "Val")
usrChart = LineChart(["Q1"], [Series("U", [100])], "Period", "Count")`,

  `Pattern — Alert variants (info/success/warning/destructive):
warn = Alert("Title", "Description text.", "warning")`,

  `Pattern — DialogBlock for inline detail-on-button:
detail = DialogBlock("View", "Title", "Brief", [TextContent("Body")], "outline")`,

  `Pattern — Table with expandableRows (click row to drill down):
tbl = Table(columns=[c1, c2], rows=[["1", "a"], ["2", "b"]], expandableRows=[exp1, []])
c1 = Col(header="ID", type="number")
c2 = Col(header="Label")
exp1 = [TextContent("Details for row 1"), subTable]
subTable = Table(columns=[Col(header="sub")], rows=[["x"]])`,

  `Pattern — Kanban de workflow (SEMPRE assim — RUNTIME, sem LLM):
root = Card([header, board, fu])
header = CardHeader("Kanban do AP 6.4")
kb = Query("get_workflow_kanban", {id: 106}, {stages: []})
board = WorkflowKanban(kb)
fu = FollowUpBlock([fu1, fu2, fu3])
# O runtime busca o kanban e monta colunas/cards/drag/edição/+Nova sozinho.
# Você NÃO lista tasks, NÃO chama tools de dados, NÃO monta cards. Só Query + WorkflowKanban.
# Sintaxe Query: nome = Query("tool", {args}, {defaults}) — NÃO use $ no nome.
# NUNCA use Kanban/KanbanColumn/KanbanCard manual pra kanban de workflow.`,

  `Pattern — KanbanCard com expandable (click expande in-place):
t = KanbanCard(title="Title", badges=["15d 6h"], responsibleName="Name", id="419", expandable=[detail])
detail = TextContent("Description shown when user clicks card.")`,

  `Pattern — Collapsible (single block fold/unfold):
notes = Collapsible("More info", [TextContent("Hidden until clicked.")], false)`,

  `Pattern — List with status (checklist):
list = List([i1, i2, i3], "check", "Tasks")
i1 = ListItem("Done item", "", "done")
i2 = ListItem("Doing now", "Subtext", "in_progress")
i3 = ListItem("Pending", "", "todo")`,

  `Pattern — List with expandable items (risks/decisions):
list = List([r1, r2])
r1 = ListItem("Risk A", "", "blocked", [TextContent("Mitigation here.")])
r2 = ListItem("Risk B", "Subtext", "info")`,

  `Pattern — Steps wizard with currentStep (1-indexed):
flow = Steps([s1, s2, s3], 2)
s1 = StepsItem("Phase 1", "Done 15/05")
s2 = StepsItem("Phase 2", "Active now")
s3 = StepsItem("Phase 3", "Pending")`,

];

export const shadcnAdditionalRules: string[] = [
  "Every response root MUST be either Card([...]) (single column, default) OR Stack([...], ...) (when multi-column layout is needed).",
  "For SINGLE-COLUMN content (most cases), use Card as root — children flow vertically automatically.",
  "For MULTI-COLUMN layouts (kanban boards, dashboards with side-by-side cards, image galleries), use Stack as root with direction='row'.",
  "You can nest Stack inside Card and Card inside Stack to build any layout. Example kanban: Stack([col1, col2, col3], 'row', 'm') where each colN = Card([CardHeader(...), Stack([task1, task2], 'column', 's')]).",
  "Use Tabs to switch between sections, Carousel for horizontal scroll, Stack for free-form layouts.",
  "Use FollowUpBlock at the END of a Card to suggest what the user can do or ask next.",
  "Carousel takes an array of slides, where each slide is an array of content.",
  "IMPORTANT: Every slide in a Carousel must use the same component structure in the same order.",
  "For forms, define one FormControl reference per field so controls can stream progressively.",
  "For forms, always provide the second Form argument with Buttons(...) actions.",
  "Never nest Form inside Form.",
  'Button variant mapping — "default" (filled primary), "secondary" (muted), "outline" (bordered), "ghost" (transparent), "link" (underlined text), "destructive" (red/danger). Use the right variant for the context.',
  'Button size mapping — "default" (standard), "xs" (extra small), "sm" (small), "lg" (large), "icon" (square icon-only).',
  'Badge/Tag variants — "default" (filled primary), "secondary" (muted fill), "destructive" (red), "outline" (bordered), "ghost" (minimal).',
  'Alert variants — "default" (neutral), "destructive" (red error), "info" (blue informational), "success" (green confirmation), "warning" (amber caution). Always pick the variant that matches the message tone.',
  "When the user asks for a specific component (e.g. 'show me an accordion'), generate a realistic, fully-populated example of that component with sample data.",
  "Use CardHeader for section titles. Use TextContent for body text. Use MarkDownRenderer for rich formatted text with links, bold, lists.",
  "Use CodeBlock with a language prop for code snippets. Always set the language for syntax context.",
  "Use Progress for completion/loading indicators.",
  "Use Avatar for user/profile images. Use Image/ImageBlock for content images.",
  'Use Heading for section titles with level: "h1" | "h2" | "h3" | "h4". Use Blockquote for quotes. Use InlineCode for inline code.',
  "Use DialogBlock to show a button that opens a modal dialog with content inside. Good for details/previews.",
  "Use AlertDialogBlock for confirmation dialogs (delete, logout, etc). Confirm action sends message to LLM.",
  "Use DrawerBlock for bottom panels with additional content. Good for details/reports.",
  "Use PaginationBlock for paginated data. currentPage/totalPages are required.",
  'Use CalendarBlock for standalone calendar display. mode: "single" (pick one date), "multiple" (pick many), "range" (date range). Use numberOfMonths to show side-by-side months.',
];

export const shadcnPromptOptions: PromptOptions = {
  examples: shadcnExamples,
  additionalRules: shadcnAdditionalRules,
  // inlineMode: LLM pode misturar texto e bloco openui-lang opcional.
  // "Oi" / "obrigado" / confirmações viram texto puro — não precisa virar
  // Card([header, body, followUps]). Ganho típico: 50-90% em respostas
  // conversacionais curtas.
  inlineMode: true,
  // editMode: em conversa multi-turn o LLM emite SÓ os statements que
  // mudaram (merge por nome no parser). Doc oficial cita ~85% menos
  // tokens em segundo turno em diante.
  editMode: true,
};

// ── Library ──

export const shadcnChatLibrary = createLibrary({
  // Pode usar Card (single-column padrão) OU Stack (multi-column kanban/dashboards)
  // como root — Stack adicionado em 2026-05-25 pra suportar layouts ricos.
  root: "Card",
  componentGroups: shadcnComponentGroups,
  components: [
    // Root
    ChatCard,
    CardHeader,
    // Content
    TextContent,
    MarkDownRenderer,
    Alert,
    ShadcnBadgeComponent,
    Avatar,
    CodeBlock,
    Image,
    ImageBlock,
    FileDownload,
    Progress,
    Separator,
    // Tables
    Table,
    Col,
    // Charts (2D)
    BarChartCondensed,
    LineChartCondensed,
    AreaChartCondensed,
    RadarChartComponent,
    Series,
    // Charts (1D)
    PieChartComponent,
    RadialChartComponent,
    Slice,
    // Charts (Scatter)
    ScatterChartComponent,
    ScatterSeries,
    Point,
    // Forms
    Form,
    FormControl,
    Label,
    Input,
    TextArea,
    Select,
    SelectItem,
    DatePicker,
    Slider,
    CheckBoxGroup,
    CheckBoxItem,
    RadioGroup,
    RadioItem,
    SwitchGroup,
    SwitchItem,
    // Buttons
    Button,
    Buttons,
    // Follow-ups
    FollowUpBlock,
    FollowUpItem,
    // Layout
    Tabs,
    TabItem,
    Accordion,
    AccordionItemDef,
    Carousel,
    Stack,
    // Kanban (board)
    Kanban,
    KanbanColumn,
    KanbanCard,
    WorkflowKanban,
    WorkflowGantt,
    ScheduleHealthReport,
    PendingCriticalReport,
    ResponsibilityLoadReport,
    TaskList,
    ProjectOverview,
    // Collapsible (bloco único colapsável)
    Collapsible,
    // List/ListItem (lista vertical com marcadores)
    List,
    ListItem,
    // Steps/StepsItem (sequência ordenada wizard)
    Steps,
    StepsItem,
    // Data Display
    TagBlock,
    Tag,
    // Typography
    Heading,
    Blockquote,
    InlineCode,
    // Navigation
    PaginationBlock,
    // Overlays
    DialogBlock,
    AlertDialogBlock,
    DrawerBlock,
    // Calendar
    CalendarBlock,
  ],
});
