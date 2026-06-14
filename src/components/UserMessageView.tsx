import { FileSpreadsheet, FileText } from "lucide-react";
import { fmtTime, messageTime } from "../lib/message-meta";

/**
 * Renderer custom da mensagem do USER (passado em `<Shell.Messages userMessage>`).
 *
 * Substitui o renderer default pra mostrar os anexos de forma navegável:
 *   - imagem  → thumbnail clicável (abre o original em nova aba);
 *   - arquivo → chip clicável (abre/baixa via /api/uploads/:id).
 *
 * Lê as partes do content: `text` vira texto; `binary` (com `url`) vira anexo.
 * Conteúdo string (mensagens sem anexo / follow-ups) é renderizado como texto,
 * removendo as tags internas `<content>/<context>` usadas no continue_conversation.
 */

interface MessagePart {
  type?: string;
  text?: string;
  mimeType?: string;
  url?: string;
  filename?: string;
}

interface UserMessageViewProps {
  message: {
    role?: string;
    content?: string | MessagePart[];
    id?: string;
    timestamp?: number;
    voice?: boolean; // mensagem veio de áudio (botão de microfone)
  };
}

/** Remove as tags internas do protocolo de continuação pra exibir só o texto humano. */
function stripContextTags(s: string): string {
  return s
    .replace(/<context>[\s\S]*?<\/context>/g, "")
    .replace(/<\/?content>/g, "")
    .trim();
}

function isImage(mime?: string): boolean {
  return !!mime && mime.startsWith("image/");
}

function AttachmentItem({ part }: { part: MessagePart }) {
  if (!part.url) return null;
  const name = part.filename ?? "arquivo";
  if (isImage(part.mimeType)) {
    return (
      <a
        href={part.url}
        target="_blank"
        rel="noreferrer"
        className="waves-msg-att waves-msg-att--image"
        title={name}
      >
        <img src={part.url} alt={name} className="waves-msg-att__thumb" />
      </a>
    );
  }
  const isSheet = /sheet|excel|csv/i.test((part.mimeType ?? "") + name);
  return (
    <a
      href={part.url}
      target="_blank"
      rel="noreferrer"
      download={name}
      className="waves-msg-att waves-msg-att--file"
      title={`Abrir ${name}`}
    >
      {isSheet ? <FileSpreadsheet size={16} /> : <FileText size={16} />}
      <span className="waves-msg-att__name">{name}</span>
    </a>
  );
}

export function UserMessageView({ message }: UserMessageViewProps) {
  if (message.role && message.role !== "user") return null;
  const content = message.content;

  let text = "";
  const attachments: MessagePart[] = [];

  if (typeof content === "string") {
    text = stripContextTags(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "text" && part.text) text += part.text;
      else if (part?.type === "binary" && part.url) attachments.push(part);
    }
    text = stripContextTags(text);
  }

  return (
    <div className="openui-shell-thread-message-user">
      <div className="waves-user-msg-col">
        <div className="openui-shell-thread-message-user__content">
          {attachments.length > 0 && (
            <div className="waves-msg-attachments">
              {attachments.map((p, i) => (
                <AttachmentItem key={`${p.url}-${i}`} part={p} />
              ))}
            </div>
          )}
          {text && (
            <div className="waves-msg-text">
              {message.voice && (
                <span className="waves-msg-voice" title="Mensagem de voz (transcrita)">🎤</span>
              )}
              {text}
            </div>
          )}
        </div>
        {/* Horário FORA da bolha (abaixo), igual ao meta do agente — padroniza. */}
        <div className="waves-msg-meta waves-msg-meta--user">
          {fmtTime(messageTime(message.id, message.timestamp))}
        </div>
      </div>
    </div>
  );
}
