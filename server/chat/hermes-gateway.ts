// Hosts de gateway Hermes permitidos além do loopback. Vazio (default) → só
// 127.0.0.1 (deployment co-locado: gateways fazem bind em loopback e o login
// anuncia IP público, que NÃO é roteável pelo proxy local). Quando o Hermes for
// remoto de verdade, listar os hosts aqui (CSV) pra usar o host do login.
const HERMES_ALLOWED_HOSTS = new Set(
  (process.env.HERMES_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Loopback é sempre permitido (deploy co-locado, default). Demais hosts só via
// allowlist explícita.
const HERMES_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// Allowlist de PORTA (anti-SSRF): a porta vem do login (cliente), então sem
// restrição um usuário autenticado poderia apontar o proxy pra qualquer serviço
// interno no loopback (redis:6379, postgres:5432, o próprio :3002, etc.).
//   - `HERMES_ALLOWED_PORTS` (CSV de portas exatas) — se definido, é a fonte da
//     verdade (só essas portas passam).
//   - Senão, cai na FAIXA default [HERMES_PORT_MIN, HERMES_PORT_MAX] (18000–18999),
//     onde vivem todos os api_server de gateway observados (188xx/189xx). Isso
//     bloqueia portas de serviços não-Hermes sem exigir config por-deploy.
const HERMES_ALLOWED_PORTS = new Set(
  (process.env.HERMES_ALLOWED_PORTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const HERMES_PORT_MIN = Number(process.env.HERMES_PORT_MIN || 18000);
const HERMES_PORT_MAX = Number(process.env.HERMES_PORT_MAX || 18999);

// Timeout do stream do Hermes (por turno). Só mata socket pendurado; grande o
// bastante pra não cortar geração real com tools (default 1h).
export const HERMES_STREAM_TIMEOUT_MS = Number(
  process.env.HERMES_STREAM_TIMEOUT_MS || 3_600_000,
);

function isAllowedHermesPort(p: number): boolean {
  if (HERMES_ALLOWED_PORTS.size) return HERMES_ALLOWED_PORTS.has(String(p));
  return p >= HERMES_PORT_MIN && p <= HERMES_PORT_MAX;
}

// Hostname seguro: letras/dígitos/`.`/`-` (DNS) ou IPv4. NÃO casa `@`, `/`, `:`,
// espaço — caracteres que permitiriam subverter a URL (userinfo, path, porta
// embutida) e desviar a request pra outro destino.
const SAFE_HOSTNAME = /^[a-zA-Z0-9.-]+$/;

/** Resolve o gateway Hermes a partir do host+port do LOGIN (sem lista hardcoded).
 *  Anti-SSRF (defesa-em-profundidade): porta válida + host só fora do loopback se
 *  estiver na allowlist + forma de hostname segura + a baseURL final é re-parseada
 *  com `new URL()` e re-conferida (protocolo http, hostname permitido, porta bate).
 *  Assim, mesmo que a montagem mude no futuro, o destino nunca escapa do esperado. */
export function resolveHermesGateway(
  host?: string,
  port?: number,
):
  | { ok: true; baseURL: string }
  | { ok: false; status: number; error: string } {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    return { ok: false, status: 400, error: `Porta de gateway inválida: ${String(port)}` };
  }
  // Anti-SSRF: a porta vem do cliente; restringe às portas de gateway Hermes
  // (allowlist ou faixa default) pra não virar proxy pra serviços internos.
  if (!isAllowedHermesPort(p)) {
    return { ok: false, status: 400, error: `Porta de gateway não permitida: ${p}` };
  }
  const h = (host || "").trim().toLowerCase();
  // Host do login só é honrado se: forma segura E na allowlist. Qualquer outra
  // coisa (vazio, malformado, não-listado) → loopback. Nunca um host arbitrário.
  const allowed = h && SAFE_HOSTNAME.test(h) && HERMES_ALLOWED_HOSTS.has(h);
  const useHost = allowed ? h : "127.0.0.1";
  const baseURL = `http://${useHost}:${p}/v1`;

  // Re-valida o resultado final. `useHost` já é restrito, mas re-parsear garante
  // que nenhum caractere inesperado sobreviveu à montagem (defesa-em-profundidade).
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    return { ok: false, status: 400, error: "baseURL de gateway inválida" };
  }
  const hostOk =
    HERMES_LOOPBACK_HOSTS.has(parsed.hostname) || HERMES_ALLOWED_HOSTS.has(parsed.hostname);
  // `new URL()` omite a porta default do protocolo (http→80): trata "" como 80.
  const effectivePort = parsed.port || "80";
  if (parsed.protocol !== "http:" || !hostOk || effectivePort !== String(p)) {
    return { ok: false, status: 400, error: `Destino de gateway não permitido: ${useHost}:${p}` };
  }
  return { ok: true, baseURL };
}
