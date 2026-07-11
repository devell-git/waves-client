import { useThread } from "@openuidev/react-headless";
import {
  ArrowUp,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Plus,
  Square,
  Trash2,
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
import { getKanbanCtx } from "../lib/kanban-context";
import { loadSession } from "../lib/session";

// Intenção de criar tarefa (atalho que abre o modal nativo direto). Casa
// "criar tarefa", "criar nova tarefa", "nova tarefa", "adicionar task", etc.
// no INÍCIO da mensagem — evita falsos positivos tipo "como criar tarefa?".
const CREATE_TASK_INTENT =
  /^\s*(criar?|crie|cria|nova|novo|adicionar|adiciona|add)\b.{0,24}\b(tarefa|task|atividade|card)\b/i;

interface ChatComposerProps {
  /**
   * Ref preenchido com os arquivos enviados ANTES de disparar a mensagem. O
   * `processMessage` do ChatPage lê e limpa esse ref pra anexar o texto
   * extraído no body do `/api/chat` (canal lateral — mantém a bolha do user
   * limpa, sem despejar o texto extraído inteiro na UI).
   */
  attachmentsRef: MutableRefObject<UploadedFile[]>;
  placeholder?: string;
  /** Modo de reasoning atual ("low" rápido | "medium" aprofundado) e toggle. */
  reasoningMode?: "low" | "medium";
  onToggleReasoning?: () => void;
}

function iconForKind(kind: UploadKind) {
  if (kind === "image") return <ImageIcon size={14} />;
  if (kind === "sheet") return <FileSpreadsheet size={14} />;
  return <FileText size={14} />;
}

export function ChatComposer({
  attachmentsRef,
  reasoningMode,
  onToggleReasoning,
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

  // ── Áudio → texto (microfone, estilo WhatsApp: SEGURE pra falar, ARRASTE ◀ pra cancelar) ──
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [willCancel, setWillCancel] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false); // true → descarta (não transcreve/envia)
  const pendingStopRef = useRef(false); // soltou ANTES do recorder ficar pronto (corrida)
  const startXRef = useRef(0);
  const pressStartRef = useRef(0); // pra distinguir TAP (toggle) de HOLD (push-to-talk)
  const CANCEL_DX = 80; // px arrastando p/ esquerda → cancela
  const HOLD_MS = 400; // > isso = considera HOLD (push-to-talk); senão TAP (toggle)

  const startRecording = async () => {
    if (recording || transcribing) return; // guarda: sem double-start
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Gravação de áudio não suportada neste navegador.");
      return;
    }
    discardRef.current = false;
    pendingStopRef.current = false;
    setWillCancel(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Não foi possível acessar o microfone (permissão negada?).");
      return;
    }
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mr.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      setRecording(false);
      setWillCancel(false);
      if (discardRef.current) {
        chunksRef.current = [];
        return; // DESCARTADO (arrastou pra cancelar) — não envia
      }
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      if (blob.size < 1200) return; // muito curto → toque acidental, ignora
      setTranscribing(true);
      try {
        const fd = new FormData();
        fd.append("file", blob, "audio.webm");
        fd.append("language", "pt");
        const token = loadSession()?.accessToken;
        const r = await fetch("/api/transcribe", {
          method: "POST",
          body: fd,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
        const t = (j.text ?? "").trim();
        if (t) void handleSubmit(t, { voice: true });
        else setError(j.error ?? "Não entendi o áudio — tente falar mais perto do microfone.");
      } catch {
        setError("Falha ao transcrever o áudio.");
      } finally {
        setTranscribing(false);
      }
    };
    recorderRef.current = mr;
    // Corrida: se soltou/cancelou antes de ficar pronto, encerra já.
    if (pendingStopRef.current) {
      try {
        mr.stop();
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
      }
      return;
    }
    mr.start();
    setRecording(true);
  };

  // Encerra a gravação. cancel=true → descarta (não envia).
  const finishRecording = (cancel: boolean) => {
    discardRef.current = cancel;
    const mr = recorderRef.current;
    if (mr && mr.state === "recording") mr.stop();
    else pendingStopRef.current = true; // ainda iniciando → para assim que ficar pronto
  };

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

  async function handleSubmit(overrideText?: string, opts?: { voice?: boolean }) {
    if (busy) return;
    // `overrideText` (ex.: vindo da transcrição de áudio) envia direto, sem
    // depender do que está na caixa. `opts.voice` marca a msg como áudio (🎤) —
    // out-of-band, sem sujar o conteúdo que vai pro LLM/atalhos.
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed && files.length === 0) return;

    // Ao enviar, desfaz qualquer mensagem expandida (overlay em tela cheia) —
    // senão a resposta nova chegaria atrás do overlay e o usuário perderia o
    // fluxo da conversa. MessageExport escuta este evento.
    window.dispatchEvent(new CustomEvent("waves:collapse-expanded"));

    // Atalho DETERMINÍSTICO: "criar/nova tarefa" com um kanban na tela abre o
    // modal nativo direto — sem passar pelo agente (que às vezes sugere/pergunta
    // em vez de abrir). Só intercepta se houver workflow de kanban em contexto.
    if (files.length === 0 && CREATE_TASK_INTENT.test(trimmed)) {
      // Abre o modal sempre. Com kanban na tela vem o workflow preenchido;
      // sem kanban, o modal mostra o seletor de workflow.
      window.dispatchEvent(
        new CustomEvent("waves:create-task", {
          detail: {
            workflowId: getKanbanCtx().workflowId,
            stageId: getKanbanCtx().stageId,
          },
        }),
      );
      setText("");
      return;
    }

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

    // Conteúdo da mensagem: quando há anexos, enviamos um array multimodal
    // AG-UI (texto + partes `binary` com a URL do /api/uploads/:id). O renderer
    // custom (UserMessageView) usa essas partes pra mostrar thumbnail/chip
    // clicável. O servidor descarta essas partes de imagem (URL relativa) e
    // monta a versão pro LLM a partir do body.attachments.
    if (uploaded.length > 0) {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "binary"; mimeType: string; url: string; filename: string }
      > = [];
      if (trimmed) parts.push({ type: "text", text: trimmed });
      for (const u of uploaded) {
        parts.push({
          type: "binary",
          mimeType: u.mimeType,
          url: u.url,
          filename: u.filename,
        });
      }
      processMessage({ role: "user", content: parts, ...(opts?.voice ? { voice: true } : {}) } as Parameters<typeof processMessage>[0]);
    } else {
      processMessage({ role: "user", content: trimmed, ...(opts?.voice ? { voice: true } : {}) } as Parameters<typeof processMessage>[0]);
    }

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

      {recording && (
        <div className={`waves-composer__rec-hint${willCancel ? " waves-composer__rec-hint--cancel" : ""}`}>
          {willCancel ? (
            <>
              <Trash2 size={14} /> Solte para <strong>cancelar</strong>
            </>
          ) : (
            <>
              <span className="waves-composer__rec-dot" /> Gravando… clique no 🎤 para enviar
              <button
                type="button"
                className="waves-composer__rec-cancel"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  finishRecording(true);
                }}
              >
                <Trash2 size={13} /> cancelar
              </button>
            </>
          )}
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
            className={`waves-composer__mic-button${recording ? (willCancel ? " waves-composer__mic-button--cancel" : " waves-composer__mic-button--recording") : ""}`}
            aria-label={recording ? "Clique para enviar" : "Clique para gravar (ou segure para falar)"}
            title="Clique para gravar/enviar · ou segure pra falar · arraste ◀ pra cancelar"
            aria-pressed={recording}
            disabled={transcribing}
            onPointerDown={(e) => {
              if (transcribing) return;
              e.preventDefault();
              // Já gravando (modo toggle) → este clique ENVIA.
              if (recording) {
                finishRecording(willCancel);
                return;
              }
              startXRef.current = e.clientX;
              pressStartRef.current = Date.now();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
              void startRecording();
            }}
            onPointerMove={(e) => {
              if (recording) setWillCancel(startXRef.current - e.clientX > CANCEL_DX);
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              const held = Date.now() - pressStartRef.current;
              // HOLD (segurou) → soltar envia/cancela. TAP (clique) → segue gravando
              // (modo toggle); o próximo clique encerra.
              if (held >= HOLD_MS) finishRecording(willCancel);
            }}
            onPointerCancel={() => finishRecording(true)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {transcribing ? (
              <Loader2 size={18} className="waves-composer__spin" />
            ) : recording ? (
              willCancel ? <Trash2 size={16} /> : <Square size={15} fill="currentColor" />
            ) : (
              <Mic size={18} />
            )}
          </button>
          {onToggleReasoning && (
            <button
              type="button"
              className="waves-composer__reasoning-button"
              aria-pressed={reasoningMode === "medium"}
              title={
                reasoningMode === "medium"
                  ? "Modo aprofundado: análise mais elaborada, pode demorar mais. Clique p/ rápido."
                  : "Modo rápido: respostas ágeis pro dia a dia. Clique p/ aprofundar."
              }
              onClick={onToggleReasoning}
            >
              {reasoningMode === "medium" ? "🧠 Aprofundado" : "⚡ Rápido"}
            </button>
          )}
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
