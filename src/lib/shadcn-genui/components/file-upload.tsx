"use client";

import {
  defineComponent,
  useIsStreaming,
} from "@openuidev/react-lang";
import * as React from "react";
import { z } from "zod";
import { uploadFiles, formatBytes, type UploadedFile } from "../../../api/uploads";
import { Upload, FileText, X, Loader2, CheckCircle2 } from "lucide-react";

const FileUploadSchema = z.object({
  label: z.string().optional(),
  accept: z.string().optional(),
  multiple: z.boolean().optional(),
  message: z.string().optional(),
});

export const FileUpload = defineComponent({
  name: "FileUpload",
  props: FileUploadSchema,
  description:
    'File upload area with drag & drop. When the user uploads a file, sends a message with the file path and extracted text. ' +
    'label: button text (default "Enviar arquivo"). accept: file types (default ".pdf,.docx,.xlsx"). ' +
    'multiple: allow multiple files (default false). message: custom message prefix sent after upload ' +
    '(default "Arquivo enviado: {filename}"). Use inside a Card for best visual.',
  component: ({ props }) => {
    const isStreaming = useIsStreaming();

    const label = String(props.label ?? "Enviar arquivo");
    const accept = String(props.accept ?? ".pdf,.docx,.xlsx,.xls,.pptx,.csv,.txt");
    const multiple = props.multiple ?? false;
    const messagePrefix = props.message ?? "";

    const [dragOver, setDragOver] = React.useState(false);
    const [uploading, setUploading] = React.useState(false);
    const [uploaded, setUploaded] = React.useState<UploadedFile[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleFiles = React.useCallback(
      async (fileList: FileList | File[]) => {
        const files = Array.from(fileList);
        if (!files.length) return;

        setError(null);
        setUploading(true);

        try {
          const result = await uploadFiles(files);
          setUploaded(result);

          // Dispatch event with uploaded files — ChatPage handles sending
          // the message in the same format as the composer (binary parts + attachments)
          window.dispatchEvent(
            new CustomEvent("waves:file-upload-complete", {
              detail: { files: result },
            }),
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "Falha no upload");
        } finally {
          setUploading(false);
        }
      },
      [messagePrefix],
    );

    const onDrop = React.useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) {
          handleFiles(e.dataTransfer.files);
        }
      },
      [handleFiles],
    );

    if (uploaded.length > 0) {
      return (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-4">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-300 mb-2">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium text-sm">
              {uploaded.length === 1 ? "Arquivo enviado" : `${uploaded.length} arquivos enviados`}
            </span>
          </div>
          {uploaded.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm text-muted-foreground ml-7">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{f.filename}</span>
              <span className="text-xs opacity-60">{formatBytes(f.size)}</span>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && !isStreaming && inputRef.current?.click()}
        className={`
          relative rounded-lg border-2 border-dashed p-6 text-center cursor-pointer
          transition-colors duration-150
          ${dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
          }
          ${uploading || isStreaming ? "opacity-50 pointer-events-none" : ""}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
          }}
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Enviando...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground/60" />
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">
              Arraste o arquivo aqui ou clique para selecionar
            </span>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-center gap-1 justify-center text-sm text-destructive">
            <X className="h-4 w-4" />
            {error}
          </div>
        )}
      </div>
    );
  },
});
