/**
 * Upload de arquivos do chat.
 *
 * `POST /api/uploads` (multipart, campo `files`) recebe 1..N arquivos, salva o
 * original em `uploads/<uuid>/<nome>` e EXTRAI texto por tipo:
 *   - PDF                    → pdf-parse
 *   - DOCX                   → mammoth (extractRawText)
 *   - XLSX/XLS/XLSM          → sheetjs (cada sheet vira CSV)
 *   - texto/CSV/JSON/MD/code → UTF-8 direto
 *   - imagem / binário       → sem texto (só salvo + referenciado por caminho)
 *
 * Retorna metadata + texto extraído (truncado). O composer injeta esse texto
 * como contexto na mensagem do user — funciona em qualquer branch/modelo, já
 * que o que chega no Hermes/LLM é texto puro (o api_server achata content).
 *
 * `GET /api/uploads/:id` devolve o arquivo original (preview/download e URL de
 * visão pros branches codex/openai).
 */
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
// Importa o módulo interno — o entrypoint `pdf-parse` roda código de debug
// (lê um PDF de teste) quando `module.parent` é undefined, o que quebra em ESM.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { getActiveTenant, isTenantResolved, type Tenant } from "./tenants.js";
import { getWavesUser, type WavesSession } from "./waves-client.js";
import { signUpload, verifyUpload } from "./signed-url.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPLOAD_DIR = resolve(rootDir, "uploads");

/** Sanitiza um segmento (tenant/owner) pra uso seguro em path. */
function seg(v: string | number): string {
  return String(v).replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "_";
}

/** Extrai o Bearer do header Authorization. */
function bearerOf(req: { headers: Record<string, unknown> }): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

interface UploadMeta {
  tenant: string;
  owner: number;
  filename: string;
  mimeType: string;
  kind: string;
  size: number;
  createdAt: number;
}

/** Limite por texto extraído injetado no prompt (caracteres). */
const MAX_TEXT_CHARS = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB (alinhado ao express.json)
const MAX_FILES = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

type FileKind = "pdf" | "doc" | "sheet" | "text" | "image" | "other";

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".xml",
  ".yaml", ".yml", ".html", ".htm", ".css", ".js", ".ts", ".jsx", ".tsx",
  ".py", ".sql", ".sh", ".env", ".ini", ".conf", ".toml",
]);

function classify(mime: string, ext: string): FileKind {
  if (mime === "application/pdf" || ext === ".pdf") return "pdf";
  if (ext === ".docx" || mime.includes("wordprocessingml")) return "doc";
  if ([".xlsx", ".xls", ".xlsm"].includes(ext) || mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") {
    return "sheet";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXTS.has(ext)) {
    return "text";
  }
  return "other";
}

/** Sanitiza nome de arquivo pra uso seguro no filesystem. */
function sanitize(name: string): string {
  const base = name.replace(/[/\\]/g, "_").replace(/[^\w.\- ]+/g, "_").trim();
  return base.slice(0, 120) || "file";
}

interface ExtractResult {
  text?: string;
  truncated?: boolean;
  error?: string;
}

async function extractText(
  buf: Buffer,
  kind: FileKind,
): Promise<ExtractResult> {
  try {
    let raw = "";
    switch (kind) {
      case "pdf": {
        const data = await pdfParse(buf);
        raw = (data?.text ?? "").trim();
        break;
      }
      case "doc": {
        const result = await mammoth.extractRawText({ buffer: buf });
        raw = (result?.value ?? "").trim();
        break;
      }
      case "sheet": {
        const wb = XLSX.read(buf, { type: "buffer" });
        const parts: string[] = [];
        for (const name of wb.SheetNames) {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
          if (csv.trim()) parts.push(`## ${name}\n${csv.trim()}`);
        }
        raw = parts.join("\n\n");
        break;
      }
      case "text":
        raw = buf.toString("utf-8");
        break;
      default:
        return {}; // image / other → sem texto
    }
    if (!raw) return {};
    if (raw.length > MAX_TEXT_CHARS) {
      return { text: raw.slice(0, MAX_TEXT_CHARS), truncated: true };
    }
    return { text: raw };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export interface UploadedFileMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: FileKind;
  /** URL pra recuperar o original (preview/download/visão). */
  url: string;
  /** Caminho absoluto no disco — referência pro agente abrir via skill. */
  path: string;
  text?: string;
  truncated?: boolean;
  error?: string;
}

export const uploadsRouter = Router();

// Captura o tenant ANTES do multer — o multer (busboy/streams) pode perder o
// contexto do AsyncLocalStorage, fazendo getActiveTenant() retornar UNRESOLVED
// dentro do handler async. Fixando no req, o handler usa o tenant certo.
uploadsRouter.post("/", (req, _res, next) => {
  (req as any)._tenant = getActiveTenant();
  next();
}, upload.array("files", MAX_FILES), async (req, res) => {
  // Auth obrigatória: o upload é vinculado ao TENANT (host/ALS) + USUÁRIO (token).
  const token = bearerOf(req);
  if (!token) return res.status(401).json({ error: "Autenticação necessária." });
  const tenant = (req as any)._tenant as Tenant;
  if (!isTenantResolved(tenant)) {
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "?";
    console.error(`[upload] tenant não resolvido para host="${host}"`);
    return res.status(421).json({ error: "Tenant não configurado para este host." });
  }
  let owner: number;
  try {
    const env = (req.query.env === "dev" ? "dev" : "prod") as WavesSession["environment"];
    const user = await getWavesUser({ environment: env, accessToken: token }, tenant);
    owner = user.id;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[upload] getWavesUser falhou — tenant=${tenant.id} host=${req.headers.host}: ${detail}`);
    return res.status(401).json({ error: "Falha na validação do token.", detail });
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) {
    return res.status(400).json({ error: "Nenhum arquivo enviado (campo 'files')." });
  }

  const out: UploadedFileMeta[] = [];
  for (const f of files) {
    const id = randomUUID();
    // uploads/<tenant>/<owner>/<uuid>/ — separação física por tenant+usuário.
    const dir = resolve(UPLOAD_DIR, seg(tenant.id), seg(owner), id);
    mkdirSync(dir, { recursive: true });
    const safe = sanitize(f.originalname);
    const fullPath = resolve(dir, safe);
    writeFileSync(fullPath, f.buffer);

    const ext = extname(safe).toLowerCase();
    const kind = classify(f.mimetype || "", ext);
    const { text, truncated, error } = await extractText(f.buffer, kind);

    const meta: UploadMeta = {
      tenant,
      owner,
      filename: safe,
      mimeType: f.mimetype || "application/octet-stream",
      kind,
      size: f.size,
      createdAt: Date.now(),
    };
    writeFileSync(resolve(dir, "meta.json"), JSON.stringify(meta));

    // URL assinada (inforjável, sem header) — owner na query, tenant via host.
    const sig = signUpload(id, tenant, owner);
    out.push({
      id,
      filename: f.originalname,
      mimeType: f.mimetype || "application/octet-stream",
      size: f.size,
      kind,
      url: `/api/uploads/${id}?o=${owner}&s=${sig}`,
      path: fullPath,
      text,
      truncated,
      error,
    });
  }

  res.json({ files: out });
});

uploadsRouter.get("/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    return res.status(400).json({ error: "id inválido" });
  }

  const owner = String(req.query.o ?? "");
  const sig = String(req.query.s ?? "");

  // Caminho seguro: URL assinada (tenant via host/ALS + owner na query).
  if (owner && sig) {
    const tenant = getActiveTenant().id;
    if (!verifyUpload(id, tenant, owner, sig)) {
      return res.status(403).json({ error: "Assinatura inválida." });
    }
    const dir = resolve(UPLOAD_DIR, seg(tenant), seg(owner), id);
    // Confere que o resolved fica DENTRO de UPLOAD_DIR (anti path-traversal).
    if (!dir.startsWith(UPLOAD_DIR + "/") || !existsSync(dir)) {
      return res.status(404).json({ error: "não encontrado" });
    }
    const meta = (() => {
      try {
        return JSON.parse(readFileSync(resolve(dir, "meta.json"), "utf-8")) as UploadMeta;
      } catch {
        return null;
      }
    })();
    const file = meta?.filename ?? readdirSync(dir).find((e) => e !== "meta.json");
    if (!file) return res.status(404).json({ error: "vazio" });
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.sendFile(resolve(dir, file));
  }

  // Fallback LEGADO: uploads flat antigos (pré-separação, sem assinatura).
  // Mantém preview de mensagens antigas funcionando; recomendado limpar.
  const legacyDir = resolve(UPLOAD_DIR, id);
  if (legacyDir.startsWith(UPLOAD_DIR + "/") && existsSync(legacyDir)) {
    const entries = readdirSync(legacyDir).filter((e) => e !== "meta.json");
    if (entries.length) return res.sendFile(resolve(legacyDir, entries[0]));
  }
  return res.status(403).json({ error: "Assinatura necessária." });
});
