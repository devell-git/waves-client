export type WorkflowRecord = {
  id: number;
  name: string;
  description?: string | null;
  color?: string;
  board_id?: number;
  created_at?: string;
  [key: string]: unknown;
};

export interface WorkflowPaginationMeta {
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Extrai array de workflows de formatos comuns da API Babble/Laravel. */
export function extractWorkflows(body: unknown): WorkflowRecord[] {
  const root = asObject(body);
  if (!root) return [];

  const data = asObject(root.data) ?? root;

  const candidates: unknown[] = [
    data.workflows,
    data.items,
    data.data,
    Array.isArray(root.data) ? root.data : null,
    Array.isArray(body) ? body : null,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter(
      (item): item is WorkflowRecord =>
        asObject(item) !== null && typeof (item as WorkflowRecord).id === "number",
    );
  }

  return [];
}

/** Lê metadados de paginação quando a API pagina (ex.: 5 por página). */
export function extractWorkflowPagination(body: unknown): WorkflowPaginationMeta | null {
  const root = asObject(body);
  if (!root) return null;

  const data = asObject(root.data) ?? root;
  const meta =
    asObject(root.meta) ??
    asObject(data.meta) ??
    asObject(data.pagination) ??
    asObject(root.pagination);

  if (!meta) return null;

  const currentPage = readNumber(meta.current_page ?? meta.currentPage ?? meta.page) ?? 1;
  const lastPage = readNumber(meta.last_page ?? meta.lastPage ?? meta.total_pages) ?? currentPage;
  const perPage = readNumber(meta.per_page ?? meta.perPage ?? meta.limit) ?? extractWorkflows(body).length;
  const total = readNumber(meta.total ?? meta.total_count);

  return { currentPage, lastPage, perPage, total };
}

export function buildWorkflowsListPath(page: number, perPage = 100): string {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  return `/workflows?${params.toString()}`;
}

export interface WorkflowsListResult {
  status: string;
  data: {
    workflows: WorkflowRecord[];
    pagination?: WorkflowPaginationMeta;
  };
}

/** Normaliza resposta agregada de uma ou mais páginas. */
export function buildWorkflowsListResult(
  pages: unknown[],
): WorkflowsListResult {
  const workflows: WorkflowRecord[] = [];
  const seen = new Set<number>();

  for (const page of pages) {
    for (const wf of extractWorkflows(page)) {
      if (seen.has(wf.id)) continue;
      seen.add(wf.id);
      workflows.push(wf);
    }
  }

  const lastMeta = pages.length
    ? extractWorkflowPagination(pages[pages.length - 1])
    : null;

  return {
    status: "success",
    data: {
      workflows,
      pagination: lastMeta
        ? {
            ...lastMeta,
            currentPage: 1,
            lastPage: 1,
            perPage: workflows.length,
            total: lastMeta.total ?? workflows.length,
          }
        : undefined,
    },
  };
}
