import { useThread } from "@openuidev/react-headless";
import {
  ArrowUp,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Square,
  X,
} from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  formatBytes,
  uploadFiles,
  UPLOAD_MAX_FILE_BYTES,
  UPLOAD_MAX_FILES,
  type UploadedFile,
  type UploadKind,
} from "../api/uploads";

interface ChatComposerProps {
  /**
   * Ref preenchido com os arquivos enviados ANTES de disparar a mensagem. O
   * `processMessage` do ChatPage lê e limpa esse ref pra anexar o texto
   * extraído no body do `/api/chat` (canal lateral — mantém a bolha do user
   * limpa, sem despejar o texto extraído inteiro na UI).
   */
  attachmentsRef: MutableRefObject<UploadedFile[]>;
  placeholder?: string;
}

function iconForKind(kind: UploadKind) {
  if (kind === "image") return <ImageIcon size={14} />;
  if (kind === "sheet") return <FileSpreadsheet size={14} />;
  return <FileText size={14} />;
}

export function ChatComposer({
  attachmentsRef,
  placeholder = "Digite sua mensagem…",
}: ChatComposerProps) {
  const processMessage = useThread((s) => s.processMessage);
  const cancelMessage = useThread((s) => s.cancelMessage);
  const isRunning = useThread((s) => s.isRunning);
  const isLoadingMessages = useThread((s) => s.isLoadingMessages);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-resize do textarea (mesmo comportamento do Composer nativo).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  }, [text]);

  const busy = isRunning || isLoadingMessages || uploading;

  function addFiles(picked: FileList | null) {
    if (!picked || !picked.length) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (next.length >= UPLOAD_MAX_FILES) {
        setError(`Máximo de ${UPLOAD_MAX_FILES} arquivos por mensagem.`);
        break;
      }
      if (f.size > UPLOAD_MAX_FILE_BYTES) {
        setError(`"${f.name}" excede ${formatBytes(UPLOAD_MAX_FILE_BYTES)}.`);
        continue;
      }
      // dedupe por nome+tamanho
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      next.push(f);
    }
    setFiles(next);
    // permite re-selecionar o mesmo arquivo depois
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;

    let uploaded: UploadedFile[] = [];
    if (files.length > 0) {
      setUploading(true);
      setError(null);
      try {
        uploaded = await uploadFiles(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha no upload.");
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    // Disponibiliza os anexos (com texto extraído) pro processMessage do
    // ChatPage anexar no body. Preenchido ANTES de disparar a mensagem.
    attachmentsRef.current = uploaded;

    // Conteúdo visível na bolha do user: o texto digitado + um marcador
    // discreto dos anexos (o texto extraído NÃO aparece aqui — vai no body).
    const names = uploaded.map((u) => u.filename).join(", ");
    const marker =
      uploaded.length > 0
        ? `${trimmed ? "\n\n" : ""}📎 ${uploaded.length} arquivo(s): ${names}`
        : "";
    const visible = `${trimmed}${marker}`.trim();

    processMessage({ role: "user", content: visible });

    setText("");
    setFiles([]);
  }

  return (
    <div
      className="openui-shell-thread-composer"
      data-drafting={text.length > 0 || files.length > 0 || undefined}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, a, [role='button']")) {
          inputRef.current?.focus();
        }
      }}
    >
      {/* Chips de anexos pendentes */}
      {(files.length > 0 || error) && (
        <div className="waves-composer__attachments">
          {files.map((f, idx) => {
            const isImg = f.type.startsWith("image/");
            const isSheet = /sheet|excel|\.(xlsx?|csv)$/i.test(f.type + f.name);
            const kind: UploadKind = isImg ? "image" : isSheet ? "sheet" : "text";
            return (
              <span key={`${f.name}-${idx}`} className="waves-composer__chip">
                {iconForKind(kind)}
                <span className="waves-composer__chip-name" title={f.name}>
                  {f.name}
                </span>
                <span className="waves-composer__chip-size">
                  {formatBytes(f.size)}
                </span>
                <button
                  type="button"
                  className="waves-composer__chip-remove"
                  aria-label={`Remover ${f.name}`}
                  onClick={() => removeFile(idx)}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
          {error && <span className="waves-composer__error">{error}</span>}
        </div>
      )}

      <div className="openui-shell-thread-composer__input-wrapper">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="openui-shell-thread-composer__input"
          placeholder={placeholder}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <div className="openui-shell-thread-composer__action-bar">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
          <button
            type="button"
            className="waves-composer__attach-button"
            aria-label="Anexar arquivos"
            title="Anexar arquivos"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus size={18} />
          </button>
          <button
            type="button"
            className="openui-shell-thread-composer__submit-button waves-composer__submit-button"
            aria-label={isRunning ? "Cancelar" : "Enviar mensagem"}
            onClick={isRunning ? cancelMessage : () => void handleSubmit()}
          >
            {uploading ? (
              <Loader2 size={16} className="waves-composer__spin" />
            ) : isRunning ? (
              <Square size={16} fill="currentColor" />
            ) : (
              <ArrowUp size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
