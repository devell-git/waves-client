/**
 * Metadados de exibição das mensagens: horário e consumo de tokens.
 */

// Flag de admin (setado pelo ChatPage no login). Os renderers de mensagem são
// passados pra lib sem props extras, então leem daqui.
let adminFlag = false;
export function setAdminFlag(v: boolean): void {
  adminFlag = v;
}
export function isAdmin(): boolean {
  return adminFlag;
}

// Horário por mensagem: usa o timestamp da mensagem se houver; senão registra
// o primeiro instante em que a vimos (estável por id durante a sessão).
const seen = new Map<string, number>();
export function messageTime(id: string | undefined, tsFromMsg?: number): number {
  if (typeof tsFromMsg === "number" && tsFromMsg > 0) return tsFromMsg;
  const key = id ?? "";
  let t = seen.get(key);
  if (t == null) {
    t = Date.now();
    seen.set(key, t);
  }
  return t;
}

/**
 * Fixa o horário ORIGINAL de uma mensagem no cache, pela hidratação do histórico.
 * #830 — no reload o histórico é re-hidratado e o `seen` está vazio; sem isto,
 * `messageTime` cairia no fallback `Date.now()` (= hora atual) e TODAS as
 * mensagens passariam a exibir a hora do reload. Aqui semeamos o `seen` com o
 * timestamp real (mesmo cache do caminho "ao vivo"). Só grava ts válido.
 */
export function primeMessageTime(id: string | undefined, ts?: number): void {
  if (!id || typeof ts !== "number" || ts <= 0) return;
  // Aceita ts em segundos (epoch) OU milissegundos: < 1e12 (~ano 2001 em ms)
  // é tratado como segundos e convertido. fmtTime espera ms.
  seen.set(id, ts < 1e12 ? ts * 1000 : ts);
}
export function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export interface UsageInfo {
  p: number; // prompt tokens
  c: number; // completion tokens
  t: number; // total
}

/**
 * Extrai o marcador `<!--waves-usage:{...}-->` do conteúdo do assistant.
 * Retorna o conteúdo limpo (sem o marcador) + o usage (ou null se ausente —
 * mensagem nativa, sem chamada LLM → tokens zero).
 */
export function extractUsage(content: string): { clean: string; usage: UsageInfo | null } {
  const m = content.match(/\n?<!--waves-usage:(\{.*?\})-->/);
  if (!m) return { clean: content, usage: null };
  let usage: UsageInfo | null = null;
  try {
    const o = JSON.parse(m[1]) as Partial<UsageInfo>;
    usage = { p: Number(o.p ?? 0), c: Number(o.c ?? 0), t: Number(o.t ?? 0) };
  } catch {
    /* marcador inválido */
  }
  return { clean: content.replace(m[0], "").trimEnd(), usage };
}
