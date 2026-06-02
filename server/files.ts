/**
 * Arquivos ENVIADOS PELO AGENTE pro usuário (download seguro no chat).
 *
 * Diferente de `uploads.ts` (arquivos QUE O USUÁRIO manda pro agente), aqui é o
 * caminho inverso: o agente gera/produz um arquivo (relatório, export, imagem)
 * e oferece pro usuário baixar via o componente openui `FileDownload`.
 *
 * Modelo de segurança:
 *   - Cada arquivo vive em `agent-files/<uuid>/<nome>` + `meta.json`
 *     (`{ owner, filename, mimeType, createdAt }`). `owner` = id do usuário Waves.
 *   - `GET /api/files/:id` exige `Authorization: Bearer <token Babble>`, valida
 *     o token na Waves (`getWavesUser`) e só serve se `user.id === meta.owner`
 *     (quando `owner` está definido). Sem token válido / dono errado → 401/403.
 *   - Serve com `Content-Disposition: attachment` + `X-Content-Type-Options:
 *     nosniff` — nunca renderiza inline (evita XSS de mesma origem, já que o
 *     token do Babble fica no localStorage).
 *   - id é UUID opaco; path é resolvido e conferido dentro do diretório base
 *     (anti path-traversal).
 *
 * Como o agente registra um arquivo (lado Hermes), 2 formas:
 *   (a) escreve direto em `agent-files/<uuid>/<nome>` + `meta.json` com
 *       `owner` = id do usuário atual (que ele vê no contexto da sessão); ou
 *   (b) `POST /api/files` (multipart, autenticado) — o servidor deriva o
 *       `owner` do próprio token. Retorna `{ id, filename }`.
 * Depois emite no openui-lang: `FileDownload(id="<uuid>", filename="<nome>")`.
 */
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getWavesUser, type WavesSession } from "./waves-client.js";
import { getActiveTenant } from "./tenants.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES_DIR = resolve(rootDir, "agent-files");

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

interface FileMeta {
  owner: number | null; // id do usuário Waves dono; null = público (não-sensível)
  /** Tenant dono (quando criado via waves_client). Ausente em arquivos da skill
   *  Hermes, que não conhece o tenant — aí cai no check só-por-owner. */
  tenant?: string;
  filename: string;
  mimeType: string;
  createdAt: number;
}

function sanitize(name: string): string {
  const base = name.replace(/[/\\]/g, "_").replace(/[^\w.\- ]+/g, "_").trim();
  return base.slice(0, 120) || "arquivo";
}

const UUID_RE = /^[a-f0-9-]{36}$/i;

/** Resolve o diretório do arquivo conferindo que fica DENTRO de FILES_DIR. */
function resolveFileDir(id: string): string | null {
  if (!UUID_RE.test(id)) return null;
  const dir = resolve(FILES_DIR, id);
  if (dir !== resolve(FILES_DIR, id) || !dir.startsWith(FILES_DIR + "/")) {
    return null;
  }
  return dir;
}

function readMeta(dir: string): FileMeta | null {
  try {
    const raw = readFileSync(resolve(dir, "meta.json"), "utf-8");
    return JSON.parse(raw) as FileMeta;
  } catch {
    return null;
  }
}

/**
 * Registra um arquivo do agente em disco. Reutilizável pelo POST e por
 * scripts/skills server-side. `owner` = id do usuário Waves dono (ou null).
 */
export function registerFile(args: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  owner: number | null;
  tenant?: string;
}): { id: string; filename: string } {
  const id = randomUUID();
  const dir = resolve(FILES_DIR, id);
  mkdirSync(dir, { recursive: true });
  const safe = sanitize(args.filename);
  writeFileSync(resolve(dir, safe), args.buffer);
  const meta: FileMeta = {
    owner: args.owner,
    tenant: args.tenant,
    filename: safe,
    mimeType: args.mimeType || "application/octet-stream",
    createdAt: Date.now(),
  };
  writeFileSync(resolve(dir, "meta.json"), JSON.stringify(meta));
  return { id, filename: safe };
}

/** Extrai o Bearer do header Authorization. */
function bearerOf(req: { headers: Record<string, unknown> }): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export const filesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

// POST /api/files — upload autenticado (o owner vem do token, não do cliente).
// Pra uma skill/tool do agente que tenha o Bearer do usuário. Retorna {id}.
filesRouter.post("/", upload.single("file"), async (req, res) => {
  const token = bearerOf(req);
  if (!token) return res.status(401).json({ error: "Bearer ausente." });
  const f = (req as { file?: Express.Multer.File }).file;
  if (!f) return res.status(400).json({ error: "Arquivo ausente (campo 'file')." });

  let owner: number;
  try {
    const env = (req.query.env === "dev" ? "dev" : "prod") as WavesSession["environment"];
    const user = await getWavesUser({ environment: env, accessToken: token });
    owner = user.id;
  } catch {
    return res.status(401).json({ error: "Token Babble inválido." });
  }

  const { id, filename } = registerFile({
    buffer: f.buffer,
    filename: f.originalname,
    mimeType: f.mimetype,
    owner,
    tenant: getActiveTenant().id,
  });
  res.json({ id, filename, url: `/api/files/${id}` });
});

// GET /api/files/:id — download seguro (auth + ownership + attachment).
filesRouter.get("/:id", async (req, res) => {
  const dir = resolveFileDir(req.params.id);
  if (!dir || !existsSync(dir)) {
    return res.status(404).json({ error: "Arquivo não encontrado." });
  }
  const meta = readMeta(dir);
  if (!meta) return res.status(404).json({ error: "Metadados ausentes." });

  // Isolamento por tenant: se o arquivo tem tenant gravado, o request precisa
  // chegar pelo mesmo tenant (host/ALS). Arquivos da skill Hermes (sem tenant)
  // pulam esse check e caem só no de owner abaixo.
  if (meta.tenant && meta.tenant !== getActiveTenant().id) {
    return res.status(403).json({ error: "Sem permissão para este arquivo." });
  }

  // Controle de acesso: se o arquivo tem dono, exige token válido do dono.
  if (meta.owner != null) {
    const token = bearerOf(req);
    if (!token) return res.status(401).json({ error: "Autenticação necessária." });
    try {
      const env = (req.query.env === "dev" ? "dev" : "prod") as WavesSession["environment"];
      const user = await getWavesUser({ environment: env, accessToken: token });
      if (user.id !== meta.owner) {
        return res.status(403).json({ error: "Sem permissão para este arquivo." });
      }
    } catch {
      return res.status(401).json({ error: "Token inválido." });
    }
  }

  const filePath = resolve(dir, meta.filename);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return res.status(404).json({ error: "Arquivo ausente em disco." });
  }

  // Sempre como anexo (nunca inline) + nosniff — evita execução de HTML/SVG
  // na mesma origem (o token do Babble vive no localStorage).
  res.setHeader("Content-Type", meta.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${meta.filename.replace(/"/g, "")}"`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  createReadStream(filePath).pipe(res);
});

// Garante o diretório base na subida.
export function ensureFilesDir(): void {
  if (!existsSync(FILES_DIR)) mkdirSync(FILES_DIR, { recursive: true });
}
