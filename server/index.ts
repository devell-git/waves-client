import "./load-env.js";
import cors from "cors";
import express from "express";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  getOpenAiCredential,
  getOpenAiBaseUrl,
  getOpenAiProvider,
  maskSecret,
} from "./load-env.js";
import { handleChatRequest } from "./chat.js";
import { listProfiles } from "./profile-routing.js";
import {
  deleteThread,
  getThreadMessages,
  listThreads,
  searchThreads,
  updateThreadTitle,
} from "./thread-history.js";
import { getProgress } from "./tool-progress.js";
import { DEFAULT_OPENAI_MODEL } from "./waves-prompt.js";
import { loadOpenUISpec } from "./openui-spec.js";
import { uploadsRouter } from "./uploads.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = resolve(ROOT_DIR, "dist");

app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  const provider = getOpenAiProvider();
  let configured = false;
  let credPreview = "(não disponível)";
  let credError: string | undefined;
  try {
    const cred = getOpenAiCredential();
    configured = Boolean(cred);
    credPreview = maskSecret(cred);
  } catch (err) {
    credError = err instanceof Error ? err.message : String(err);
  }
  res.json({
    ok: true,
    openai: {
      provider,
      baseURL: getOpenAiBaseUrl() ?? "(default)",
      configured,
      credentialPreview: credPreview,
      credentialError: credError,
      model: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    },
  });
});

// --- Proxy reverso pra Babble API ------------------------------------------
// Frontend bate em `/api/waves/<path>` (mesma origem, sem CORS) e nós
// refazemos pra `https://waves.devell.com.br/api/<path>` server-side,
// injetando o X-API-KEY (tenant) do .env. Authorization Bearer do user
// passa direto.

const WAVES_UPSTREAM = (
  process.env.WAVES_URL ?? "https://waves.devell.com.br/api"
).replace(/\/+$/, "");
const WAVES_API_KEY = process.env.WAVES_TOKEN ?? "";

app.all(/^\/api\/waves(\/.*)?$/, async (req, res) => {
  if (!WAVES_API_KEY) {
    return res.status(500).json({ error: "WAVES_TOKEN não configurado no .env." });
  }
  const upstreamPath = req.url.replace(/^\/api\/waves/, "") || "/";
  const url = `${WAVES_UPSTREAM}${upstreamPath}`;

  const headers: Record<string, string> = {
    "X-API-KEY": WAVES_API_KEY,
    Accept: "application/json",
  };
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization as string;
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  if (hasBody) headers["Content-Type"] = "application/json";

  try {
    const init: RequestInit = { method: req.method, headers };
    if (hasBody) {
      init.body = JSON.stringify(req.body ?? {});
    }
    const upstream = await fetch(url, init);
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error(`[waves-proxy] ${req.method} ${url} →`, err);
    res.status(502).json({
      error: "Upstream Waves unreachable",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// --- Skills do profile Steve ---------------------------------------------
// Lê SKILL.md das pastas externas declaradas no config.yaml do Steve
// (bioshield + waves + shared) e do hub install. Retorna metadata pra UI.
//
// O caminho do hub muda por profile — pra Steve tá em workspace/BioShield/...
// Pra robusto: lista todas as pastas dentro de cada root, abre SKILL.md, extrai
// YAML frontmatter (name, description, category opcional).

const STEVE_SKILL_DIRS = [
  resolve(homedir(), ".hermes/skills/bioshield"),
  resolve(homedir(), ".hermes/skills/waves"),
  resolve(homedir(), ".hermes/skills/shared"),
  resolve(homedir(), "workspace/BioShield/profiles/hermes/hermes-bioshield-steve/skills"),
];

interface SkillMeta {
  name: string;
  description: string;
  category?: string;
  source: string; // pasta de origem
  path: string;   // caminho absoluto do diretório
}

function parseSkillFrontmatter(md: string): {
  name?: string;
  description?: string;
  category?: string;
} {
  // Extrai bloco entre `---` na primeira linha
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const block = m[1];
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+)\s*:\s*(.+?)\s*$/);
    if (!kv) continue;
    let v = kv[2].trim();
    // Remove aspas
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[kv[1].toLowerCase()] = v;
  }
  return out;
}

function listSkillsFromDir(dir: string): SkillMeta[] {
  if (!existsSync(dir)) return [];
  const out: SkillMeta[] = [];
  for (const name of readdirSync(dir)) {
    const skillPath = resolve(dir, name);
    let stat;
    try {
      stat = statSync(skillPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const mdPath = resolve(skillPath, "SKILL.md");
    if (!existsSync(mdPath)) continue;
    let content: string;
    try {
      content = readFileSync(mdPath, "utf-8");
    } catch {
      continue;
    }
    const fm = parseSkillFrontmatter(content);
    if (!fm.name) continue;
    out.push({
      name: fm.name,
      description: fm.description ?? "(sem descrição)",
      category: fm.category,
      source: dir.split("/").slice(-1)[0],
      path: skillPath,
    });
  }
  return out;
}

// --- Runtime info (profile detectado + starters contextuais) -------------
// Permite o frontend mostrar conversation starters apropriados pro profile
// ativo. Profile inferido pela porta do HERMES_BASE_URL — sem hardcode no
// frontend. Pra novos profiles, edite PROFILE_STARTERS abaixo.
interface ProfileStarterFormField {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "email";
  required?: boolean;
}

interface ProfileStarter {
  displayText: string;
  /** Prompt direto pro agente quando o starter NÃO tem form. */
  prompt: string;
  /** Quando presente, click abre form local. Submit dispara message. */
  formFields?: ProfileStarterFormField[];
  /** Template do prompt enviado após submit do form. `{{name}}` → valor. */
  submitPromptTemplate?: string;
}

const PROFILE_STARTERS: Record<string, ProfileStarter[]> = {
  "18860": [
    // Steve (BioShield CDMO) — starters fixos pras consultas mais comuns
    {
      displayText: "Action Plans abertos",
      prompt: "Liste todos os Action Plans abertos hoje, com responsável e estágio. Use dashboard visual.",
    },
    {
      displayText: "Status do projeto",
      prompt: "Me dá um overview do BIOSHIELD agora: fase, frentes ativas, próximos marcos.",
    },
    {
      displayText: "Tarefas críticas",
      prompt: "Quais são as tasks de maior prioridade ou em atraso nos Action Plans?",
    },
    {
      displayText: "Funil de captação",
      prompt: "Mostra o estado atual do funil de captação e investimento do projeto.",
    },
  ],
  "18862": [
    // ybrax-negative-media — Mídia Adversa (CPF + CNPJ)
    { displayText: "Consultar CNPJ", prompt: "__form_cnpj__" },
    { displayText: "Consultar CPF", prompt: "__form_cpf__" },
  ],
  "18864": [
    // ybrax-verifique — hub YBRAX (Verifique + consultas). Dois starters:
    // o SOUL renderiza o form específico por tipo de documento.
    { displayText: "Consultar CPF", prompt: "__form_cpf__" },
    { displayText: "Consultar CNPJ", prompt: "__form_cnpj__" },
  ],
};

const PROFILE_NAMES: Record<string, string> = {
  "18860": "bioshield-steve",
  "18862": "ybrax-negative-media",
  "18864": "ybrax-verifique",
};

const PROFILE_ID_TO_PORT: Record<string, string> = {
  "bioshield-steve": "18860",
  "ybrax-negative-media": "18862",
  "ybrax-verifique": "18864",
};

function detectProfile(requestedId?: string) {
  // Se o frontend pediu um profile específico (?profile=ybrax-map), respeita.
  // Caso contrário, fallback pro env HERMES_BASE_URL (default histórico).
  let port: string;
  if (requestedId && PROFILE_ID_TO_PORT[requestedId]) {
    port = PROFILE_ID_TO_PORT[requestedId];
  } else {
    const baseURL =
      process.env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:18862/v1";
    const m = baseURL.match(/:(\d+)/);
    port = m ? m[1] : "18862";
  }
  return {
    id: PROFILE_NAMES[port] ?? `unknown-${port}`,
    port,
    starters: PROFILE_STARTERS[port] ?? [],
  };
}

app.get("/api/runtime", (req, res) => {
  const requested = typeof req.query.profile === "string" ? req.query.profile : undefined;
  const profile = detectProfile(requested);
  res.json({
    provider: getOpenAiProvider(),
    profile: profile.id,
    port: profile.port,
    defaultStarters: profile.starters,
    model:
      process.env.HERMES_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  });
});

// Lista de profiles disponíveis (fixa por enquanto). Frontend usa pra montar
// as tabs. Quando virar dinâmico: ler de /home/bot/.hermes/profiles/.
app.get("/api/profiles", (_req, res) => {
  res.json({ profiles: listProfiles() });
});

// ─── Histórico de conversas (threads) ──────────────────────────────────
// Cada profile tem seu próprio state.db. As rotas aqui leem/escrevem nele
// pra listar, buscar, retomar, renomear e excluir conversas.

app.get("/api/threads", (req, res) => {
  const profile = String(req.query.profile ?? "");
  if (!profile) return res.status(400).json({ error: "profile required" });
  try {
    const threads = listThreads(profile, 200);
    res.json({ threads });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/threads/search", (req, res) => {
  const profile = String(req.query.profile ?? "");
  const q = String(req.query.q ?? "");
  if (!profile) return res.status(400).json({ error: "profile required" });
  try {
    const hits = searchThreads(profile, q, 50);
    res.json({ hits });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/threads/:id/messages", (req, res) => {
  const profile = String(req.query.profile ?? "");
  if (!profile) return res.status(400).json({ error: "profile required" });
  try {
    const messages = getThreadMessages(profile, req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch("/api/threads/:id", (req, res) => {
  const profile = String(req.query.profile ?? "");
  const title = String((req.body as { title?: unknown })?.title ?? "");
  if (!profile) return res.status(400).json({ error: "profile required" });
  if (!title.trim()) return res.status(400).json({ error: "title required" });
  try {
    const ok = updateThreadTitle(profile, req.params.id, title);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/threads/:id", (req, res) => {
  const profile = String(req.query.profile ?? "");
  if (!profile) return res.status(400).json({ error: "profile required" });
  try {
    const ok = deleteThread(profile, req.params.id);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Progress da tool em execução no Hermes — frontend polla durante o stream
// pra mostrar no ThinkingIndicator. Retorna null quando nada está em
// execução ou quando o último progress está stale (>10s).
app.get("/api/chat/progress", (_req, res) => {
  res.json({ progress: getProgress() });
});

// --- Proxy pra rendered_api (specialist jobs em openui-lang) ---------------
// Frontend polla `/api/specialist-jobs/:id/rendered` enquanto o sub-agent
// (Vigia/Cronos/etc.) ainda está processando. Encaminhamos pro daemon
// Python em :18861, que devolve `{status, openui_lang?, eta_s?, error?}`.
// Detalhes em ~/.hermes/shared-knowledge/bioshield/specialist_jobs/rendered_api.py
const RENDERED_API_BASE = (
  process.env.RENDERED_API_URL ?? "http://127.0.0.1:18861"
).replace(/\/+$/, "");

app.get("/api/specialist-jobs/:id/rendered", async (req, res) => {
  const jobId = req.params.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return res.status(400).json({ error: "job_id inválido" });
  }
  try {
    const upstream = await fetch(
      `${RENDERED_API_BASE}/specialist-jobs/${encodeURIComponent(jobId)}/rendered`,
      { signal: AbortSignal.timeout(150_000) },
    );
    const text = await upstream.text();
    res.status(upstream.status);
    res.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    res.send(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "rendered_api offline";
    res.status(502).json({
      status: "proxy_error",
      error: `rendered_api unreachable: ${msg}`,
    });
  }
});

// --- Spec OpenUI da Waves (cache 5min server-side) ------------------------
app.get("/api/openui/spec", async (_req, res) => {
  try {
    const spec = await loadOpenUISpec();
    res.json(spec);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "spec unavailable",
    });
  }
});

app.get("/api/skills", (_req, res) => {
  const seen = new Set<string>();
  const all: SkillMeta[] = [];
  for (const dir of STEVE_SKILL_DIRS) {
    for (const s of listSkillsFromDir(dir)) {
      // dedupe por nome — primeira ocorrência vence
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      all.push(s);
    }
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ count: all.length, skills: all });
});

app.get("/api/skills/:name", (req, res) => {
  const name = req.params.name;
  for (const dir of STEVE_SKILL_DIRS) {
    const skillDir = resolve(dir, name);
    const mdPath = resolve(skillDir, "SKILL.md");
    if (!existsSync(mdPath)) continue;
    try {
      const content = readFileSync(mdPath, "utf-8");
      const fm = parseSkillFrontmatter(content);
      return res.json({
        name,
        description: fm.description ?? null,
        category: fm.category ?? null,
        source: dir.split("/").slice(-1)[0],
        path: skillDir,
        content,
      });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : "read failed",
      });
    }
  }
  return res.status(404).json({ error: `Skill '${name}' não encontrada.` });
});

// POST /api/skills/:name/start — wrapper que injeta mensagem natural pro Steve
// disparar a skill (Discovery → Activation → Execution). Streama via /api/chat
// reaproveitando o pipeline OpenUI/Hermes existente.
app.post("/api/skills/:name/start", async (req, res) => {
  const name = req.params.name;
  const params = req.body?.params;
  const wavesSession = req.body?.wavesSession;
  const user = req.body?.user;

  // Confirma que a skill existe
  let skillExists = false;
  for (const dir of STEVE_SKILL_DIRS) {
    if (existsSync(resolve(dir, name, "SKILL.md"))) {
      skillExists = true;
      break;
    }
  }
  if (!skillExists) {
    return res.status(404).json({ error: `Skill '${name}' não encontrada.` });
  }

  // Mensagem natural: ativa o Steve via Discovery natural-language.
  const paramsStr =
    params && Object.keys(params).length > 0
      ? `\n\nParâmetros:\n\`\`\`json\n${JSON.stringify(params, null, 2)}\n\`\`\``
      : "";
  const prompt = `Execute a skill \`${name}\`.${paramsStr}\n\nRetorne o resultado em openui-lang (Card + componentes).`;

  // Redireciona pro /api/chat — mesmo SSE protocol
  const chatBody = {
    messages: [{ role: "user", content: prompt }],
    wavesSession,
    user,
  };
  try {
    const { handleChatRequest } = await import("./chat.js");
    const response = await handleChatRequest(chatBody);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "skill start failed",
    });
  }
});

// --- Upload de arquivos do chat (multipart) --------------------------------
// POST /api/uploads → salva + extrai texto. GET /api/uploads/:id → original.
app.use("/api/uploads", uploadsRouter);

app.post("/api/chat", async (req, res) => {
  try {
    const response = await handleChatRequest(req.body);
    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Erro interno no chat.",
    });
  }
});

// --- Serve static build (SPA) ----------------------------------------------
// Quando `dist/` existe (build feito), Express serve os assets E faz fallback
// pra index.html nas rotas client-side (/, /login, /chat, etc.). Sem build, só
// /api/* funciona — use `npm run dev` pra ter Vite servindo + HMR.
const hasBuild = existsSync(resolve(DIST_DIR, "index.html"));

if (hasBuild) {
  // Cache strategy:
  //
  // - `index.html` (entry da SPA): NUNCA cachear. Browser sempre puxa a
  //   versão atual, que referencia o bundle JS com hash atual. Garante
  //   que mobile/desktop peguem updates sem precisar de hard refresh.
  //
  // - Assets com hash no nome (`index-XXXXXXXX.js`, `*.css`, etc., gerados
  //   pelo vite/rollup): imutáveis — o nome muda quando o conteúdo muda.
  //   Pode cachear "forever" (1 ano) sem risco de servir versão velha.
  app.use(
    express.static(DIST_DIR, {
      index: false, // /api/* tem prioridade
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader(
            "Cache-Control",
            "no-cache, no-store, must-revalidate",
          );
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        } else {
          // Vite gera hash no nome (ex: index-D1OtG82D.js); cacheia 1 ano
          res.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        }
      },
    }),
  );

  // SPA fallback: qualquer rota não-api devolve o index.html (React Router cuida).
  // Headers de no-cache pra garantir que o entry sempre venha fresco.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    if (req.method !== "GET") return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(resolve(DIST_DIR, "index.html"));
  });
}

app.listen(port, () => {
  const provider = getOpenAiProvider();
  const baseURL = getOpenAiBaseUrl() ?? "(default)";
  let credDesc: string;
  try {
    credDesc = `configurada (${maskSecret(getOpenAiCredential())})`;
  } catch (err) {
    credDesc = `ERRO: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.log(`Chat server listening on http://localhost:${port}`);
  console.log(`OpenAI provider: ${provider}  baseURL: ${baseURL}`);
  console.log(`Credential: ${credDesc}`);
  console.log(`Model: ${process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL}`);
  console.log(
    hasBuild
      ? `SPA: servindo ${DIST_DIR} (acessa /, /login, /chat pela mesma porta)`
      : `SPA: dist/ ausente — só /api/* funciona. Roda \`npm run build\` ou \`npm run dev\` (vite separado).`,
  );
});
