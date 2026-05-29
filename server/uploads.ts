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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
// Importa o módulo interno — o entrypoint `pdf-parse` roda código de debug
// (lê um PDF de teste) quando `module.parent` é undefined, o que quebra em ESM.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPLOAD_DIR = resolve(rootDir, "uploads");

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

uploadsRouter.post("/", upload.array("files", MAX_FILES), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) {
    return res.status(400).json({ error: "Nenhum arquivo enviado (campo 'files')." });
  }

  const out: UploadedFileMeta[] = [];
  for (const f of files) {
    const id = randomUUID();
    const dir = resolve(UPLOAD_DIR, id);
    mkdirSync(dir, { recursive: true });
    const safe = sanitize(f.originalname);
    const fullPath = resolve(dir, safe);
    writeFileSync(fullPath, f.buffer);

    const ext = extname(safe).toLowerCase();
    const kind = classify(f.mimetype || "", ext);
    const { text, truncated, error } = await extractText(f.buffer, kind);

    out.push({
      id,
      filename: f.originalname,
      mimeType: f.mimetype || "application/octet-stream",
      size: f.size,
      kind,
      url: `/api/uploads/${id}`,
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
  const dir = resolve(UPLOAD_DIR, id);
  if (!existsSync(dir)) return res.status(404).json({ error: "não encontrado" });
  const entries = readdirSync(dir);
  if (!entries.length) return res.status(404).json({ error: "vazio" });
  return res.sendFile(resolve(dir, entries[0]));
});
