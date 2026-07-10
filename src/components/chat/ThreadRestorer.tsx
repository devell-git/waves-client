import { useEffect, useRef } from "react";
import {
  useThread,
  type Message,
} from "@openuidev/react-headless";
import {
  getThreadMessages,
  toOpenUIMessage,
} from "../../api/threads";
import { loadShortcuts } from "../../lib/shortcut-history";
import { primeMessageTime } from "../../lib/message-meta";

export function ThreadRestorer({
  profileId,
  fullThreadKey,
}: {
  profileId: string;
  fullThreadKey: string;
}) {
  const setMessages = useThread((s) => s.setMessages);
  const restoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fullThreadKey || restoredKeyRef.current === fullThreadKey) return;
    const isSwitch = restoredKeyRef.current !== null;
    restoredKeyRef.current = fullThreadKey;
    if (isSwitch) setMessages([]);
    let cancelled = false;
    (async () => {
      let msgs: Awaited<ReturnType<typeof getThreadMessages>> = [];
      try {
        msgs = await getThreadMessages(profileId, fullThreadKey);
      } catch {
        /* sem histórico / rede — segue só com os atalhos locais (se houver) */
      }
      if (cancelled) return;
      const norm = (t: number) => (t && t < 1e12 ? t * 1000 : t || 0);
      const gwContents = new Set(msgs.map((m) => m.content));
      const items: Array<{ ts: number; msg: Message }> = [];
      msgs.forEach((m) => {
        const om = toOpenUIMessage(m);
        if (om) items.push({ ts: norm(m.timestamp), msg: om });
      });
      for (const s of loadShortcuts(fullThreadKey)) {
        if (gwContents.has(s.content)) continue;
        const scId = `sc-${s.ts}-${s.role}`;
        primeMessageTime(scId, s.ts);
        items.push({
          ts: s.ts,
          msg: { id: scId, role: s.role, content: s.content } as Message,
        });
      }
      if (cancelled || items.length === 0) return;
      items.sort((a, b) => a.ts - b.ts);
      setMessages(items.map((i) => i.msg));
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, fullThreadKey, setMessages]);

  return null;
}
