/**
 * Client do upload de arquivos do chat.
 *
 * Envia os arquivos pro `POST /api/uploads` (multipart), que salva o original
 * e devolve metadata + texto extraído (PDF/DOCX/XLSX/texto). O composer usa
 * esse retorno pra montar o contexto que vai junto da mensagem.
 */

import { loadSession } from "../lib/session";

export type UploadKind = "pdf" | "doc" | "sheet" | "text" | "image" | "other";

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: UploadKind;
  /** URL relativa pra recuperar o original (preview/download). */
  url: string;
  /** Caminho absoluto no servidor — referência pro agente. */
  path: string;
  /** Texto extraído (truncado se grande). Ausente em imagem/binário. */
  text?: string;
  truncated?: boolean;
  error?: string;
}

/** Limites espelhados do servidor (server/uploads.ts). */
export const UPLOAD_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const UPLOAD_MAX_FILES = 10;

export async function uploadFiles(files: File[]): Promise<UploadedFile[]> {
  if (!files.length) return [];
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);

  // Bearer do usuário — o servidor vincula o upload ao tenant (host) + usuário.
  const token = loadSession()?.accessToken;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch("/api/uploads", { method: "POST", body: form, headers });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) detail = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(`Falha no upload: ${detail}`);
  }
  const json = (await res.json()) as { files: UploadedFile[] };
  return json.files ?? [];
}

/** Formata bytes pra label de chip (1.2 MB, 340 KB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
