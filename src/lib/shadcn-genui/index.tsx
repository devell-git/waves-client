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
      "Progress",
      "Separator",
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
    name: "Kanban (board)",
    components: ["Kanban", "KanbanColumn", "KanbanCard"],
    notes: [
      '- Use `Kanban(columns=[...], title?)` para qualquer pedido com "kanban", "board", "agrupar por stage". É PREFERIDO sobre Stack(direction="horizontal") quando o objetivo for visualizar tasks por estágio.',
      '- `KanbanColumn(name, color?, count?, cards=[...])` — uma coluna com header. color: hex (#dc3545) → borda colorida do header. count: número de cards (mostrado como badge).',
      '- `KanbanCard(title, badges?, progress?, responsibleName?, responsibleAvatar?, tags?, id?, expandable?)` — card de uma task. badges: lista curta de strings (ex.: ["15d 6h"]). progress: 0-100 (vira barra). tags: chips coloridos. expandable: array de componentes que aparece embaixo do card quando o user clica (útil pra descrição, checklist, histórico, comentários).',
      "- Mapeamento ideal do `waves_openui_get_workflow_kanban`: stage.color → KanbanColumn.color; task.time_in_current_stage → badges[0]; task.items_completed/items_count → progress; task.responsible.name/avatar → responsibleName/responsibleAvatar; task.task_type.name → tags[0]; task.description ou subtasks → expandable.",
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

  `Pattern — Kanban nativo (board horizontal Trello-style, PREFERIDO sobre Stack direction='row'):
board = Kanban([col1, col2, col3])
col1 = KanbanColumn("To Do", "#dc3545", 2, [t1, t2])
col2 = KanbanColumn("In Progress", "#ffc107", 0, [])
col3 = KanbanColumn("Done", "#198754", 0, [])
t1 = KanbanCard(title="Title", badges=["15d 6h"], progress=0, responsibleName="Name", tags=["Label"], id="419")
t2 = KanbanCard(title="Title 2", badges=["10d"], responsibleName="Other")`,

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
