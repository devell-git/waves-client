/**
 * POST /api/transcribe — recebe um áudio (multipart `file`) do composer e o
 * repassa pro serviço Whisper LOCAL (faster-whisper, 127.0.0.1:18900), devolvendo
 * o texto transcrito. Genérico (qualquer profile/tenant); não toca dados do user.
 */
import { Router } from "express";
import multer from "multer";

export const transcribeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (áudio de chat é pequeno)
});

const WHISPER_URL = process.env.WHISPER_URL || "http://127.0.0.1:18900";

transcribeRouter.post("/", upload.single("file"), async (req, res) => {
  const f = req.file;
  if (!f || !f.buffer?.length) return res.status(400).json({ error: "áudio ausente" });
  const language = (typeof req.body?.language === "string" && req.body.language) || "pt";
  try {
    const fd = new FormData();
    fd.append("file", new Blob([f.buffer], { type: f.mimetype || "audio/webm" }), f.originalname || "audio.webm");
    fd.append("language", language);
    const r = await fetch(`${WHISPER_URL}/transcribe`, {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(120_000),
    });
    const j = (await r.json().catch(() => ({}))) as { text?: string; language?: string; error?: string };
    if (!r.ok) return res.status(502).json({ error: j.error || `whisper → ${r.status}` });
    return res.json({ text: j.text ?? "", language: j.language });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "falha ao transcrever";
    // Serviço fora do ar → mensagem clara pro front.
    return res.status(502).json({ error: /fetch failed|ECONNREFUSED/.test(msg) ? "serviço de transcrição indisponível" : msg });
  }
});
