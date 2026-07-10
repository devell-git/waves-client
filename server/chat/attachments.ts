import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { isOwnedUploadPath } from "../uploads.js";
import { verifyUpload } from "../signed-url.js";
import type { AttachmentPayload } from "./types.js";

function formatBytesServer(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMG_EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Lê o arquivo de imagem do disco e devolve um data-URI base64
 * (`data:image/png;base64,…`) — o formato que o api_server do Hermes aceita
 * em partes `image_url` (validado em `_normalize_multimodal_content`).
 * `null` se não conseguir ler ou se o mime não for de imagem suportada.
 */
function imageToDataUri(a: AttachmentPayload): string | null {
  let mime = a.mimeType?.toLowerCase();
  if (!mime || !mime.startsWith("image/")) {
    mime = IMG_EXT_TO_MIME[extname(a.filename).toLowerCase()];
  }
  if (!mime) return null;
  try {
    const b64 = readFileSync(a.path).toString("base64");
    if (!b64) return null;
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

// #824 — base pública do waves_client pra montar URL ABSOLUTA do anexo (retrieval
// cross-host: o lab-worker em OUTRO host fetcha a URL assinada). Se vazio, cai na
// URL relativa (o consumidor prefixa com o host do waves_client do mesmo tenant).
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
function fileRef(a: AttachmentPayload): string {
  return `${PUBLIC_BASE_URL}${a.url}`;
}

/**
 * Deriva o `owner` de um anexo a partir da sua URL assinada
 * (`/api/uploads/<id>?o=<owner>&s=<sig>`), verificando o HMAC contra o tenant
 * ativo. Retorna o owner (string) só se a assinatura confere — provando que o
 * upload foi emitido por este servidor pra este tenant. `null` caso contrário
 * (URL legada sem assinatura, forjada, ou de outro tenant).
 */
function ownerFromSignedUrl(url: string | undefined, tenantId: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "http://local");
    const m = u.pathname.match(/\/api\/uploads\/([a-f0-9-]{36})$/i);
    if (!m) return null;
    const owner = u.searchParams.get("o") ?? "";
    const sig = u.searchParams.get("s") ?? "";
    if (!owner || !sig) return null;
    return verifyUpload(m[1], tenantId, owner, sig) ? owner : null;
  } catch {
    return null;
  }
}

/**
 * Valida os anexos contra o dono real ANTES de o servidor ler qualquer arquivo
 * do disco. A URL assinada prova (id, tenant, owner) via HMAC; só então
 * confiamos nos caminhos locais (`path`/`contentPath`), exigindo que fiquem
 * DENTRO de `uploads/<tenant>/<owner>/`. Se a prova falhar ou o caminho escapar
 * do escopo, zeramos os caminhos locais — o `path` do cliente NUNCA é lido às
 * cegas (evita `readFileSync("/etc/passwd")` e leitura cross-tenant/-user).
 */
export function sanitizeAttachments(
  attachments: AttachmentPayload[],
  tenantId: string,
): AttachmentPayload[] {
  return attachments.map((a) => {
    const owner = ownerFromSignedUrl(a.url, tenantId);
    const pathOk = owner != null && isOwnedUploadPath(a.path, tenantId, owner);
    const contentOk = owner != null && isOwnedUploadPath(a.contentPath, tenantId, owner);
    if (pathOk && (contentOk || !a.contentPath)) return a;
    if (a.path || a.contentPath) {
      console.warn(
        `[chat:attach] caminho local fora do escopo do dono descartado: ${a.filename}`,
      );
    }
    return {
      ...a,
      path: pathOk ? a.path : "",
      contentPath: contentOk ? a.contentPath : undefined,
    };
  });
}

/**
 * Injeta os anexos na ÚLTIMA mensagem `user` (mutação in-place):
 *   - texto extraído (PDF/DOCX/XLSX/texto) vira um bloco `<arquivos_anexados>`;
 *   - IMAGENS viram partes `image_url` (data-URI base64) — o api_server do
 *     Hermes preserva e o modelo (que já tem visão, ver canal Telegram) enxerga.
 *
 * Quando há imagem, o conteúdo da mensagem passa a ser um array multimodal
 * `[{type:"text"}, {type:"image_url"}, …]` no formato OpenAI Chat Completions.
 */
export function injectAttachments(
  messages: unknown[],
  attachments: AttachmentPayload[],
): void {
  if (!attachments?.length) return;

  // 1. Parte textual (referência aos anexos — texto NÃO é injetado inline).
  const blocks: string[] = [
    "<arquivos_anexados>",
    "O usuário anexou os arquivos abaixo. O conteúdo extraído está incluído inline quando disponível. Não invente dados — use apenas o que está abaixo.",
    "",
  ];
  // 2. Partes de imagem (image_url) acumuladas.
  const imageParts: Array<{ type: "image_url"; image_url: { url: string } }> = [];

  for (const a of attachments) {
    const head = `### ${a.filename} (${a.mimeType} · ${formatBytesServer(a.size)})`;
    if (a.text && a.text.trim()) {
      // Texto extraído disponível — injeta inline no contexto (funciona com
      // qualquer agente, sem depender de file tool). O MAX_TEXT_CHARS (20k)
      // já limita na extração; overflow não é risco real.
      blocks.push(head);
      blocks.push(a.truncated ? "Conteúdo extraído (truncado):" : "Conteúdo extraído:");
      blocks.push('"""', a.text.trim(), '"""', "");
    } else if (a.contentPath) {
      // Sem texto em memória mas tem contentPath — fallback para file tool.
      blocks.push(head);
      blocks.push(`content_path: ${a.contentPath}`);
      blocks.push(`original_path: ${a.path}`);
      blocks.push(`url: ${fileRef(a)}`);
      blocks.push(a.truncated ? "(texto extraído foi truncado — arquivo original tem mais conteúdo)" : "");
      blocks.push("");
    } else if (a.kind === "image") {
      const dataUri = imageToDataUri(a);
      if (dataUri) {
        imageParts.push({ type: "image_url", image_url: { url: dataUri } });
        blocks.push(`${head} — imagem anexada (conteúdo visual incluído abaixo).`);
      } else {
        blocks.push(`${head} — imagem; não foi possível anexar o conteúdo visual. Recuperável (URL assinada, escopo do dono): ${fileRef(a)}`);
      }
      blocks.push("");
    } else if (a.error) {
      blocks.push(`${head} — não foi possível extrair texto (${a.error}). Arquivo recuperável (qualquer host, URL assinada, escopo do dono): ${fileRef(a)}`);
      blocks.push("");
    } else {
      // #824 — sem conteúdo legível (vídeo/áudio/binário): NÃO injeta o caminho
      // LOCAL (inútil cross-host). Injeta a URL ASSINADA — fetchável por HTTP de
      // qualquer host (lab-worker em outro servidor) e escopada por owner via sig.
      blocks.push(`${head} — sem texto extraível. Arquivo recuperável (qualquer host, URL assinada, escopo do dono): ${fileRef(a)}`);
      blocks.push("");
    }
  }
  blocks.push("</arquivos_anexados>");
  const block = blocks.join("\n");

  // Diagnóstico: confirma o que de fato foi anexado na mensagem.
  console.log(
    `[chat:attach] anexos=${attachments.length} ` +
      `imagens_embutidas=${imageParts.length} ` +
      `tipos=[${attachments.map((a) => `${a.kind}${a.text ? "+txt" : ""}`).join(", ")}]`,
  );

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (!m || m.role !== "user") continue;
    const c = m.content;

    // Extrai só o TEXTO do conteúdo existente — descarta partes de imagem
    // mandadas pelo cliente (o composer envia `binary`/`image_url` com URL
    // relativa /api/uploads, que serve só pra renderização e quebraria a
    // validação do api_server). O servidor reconstrói as imagens em base64.
    let baseText = "";
    if (typeof c === "string") {
      baseText = c;
    } else if (Array.isArray(c)) {
      baseText = (c as Array<Record<string, unknown>>)
        .filter((p) => p && p.type === "text")
        .map((p) => String((p as { text?: unknown }).text ?? ""))
        .join("");
    }

    const textCombined = baseText ? `${baseText}\n\n${block}` : block;
    m.content =
      imageParts.length > 0
        ? [{ type: "text", text: textCombined }, ...imageParts]
        : textCombined;
    return;
  }
}
