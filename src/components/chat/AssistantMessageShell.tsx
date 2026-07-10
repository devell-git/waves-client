import { useContext, type ReactNode } from "react";
import { MessageExport } from "../MessageExport";
import { ActiveThreadContext } from "../../lib/active-thread-context";
import {
  isAdmin,
  messageTime,
  fmtTime,
  extractUsage,
} from "../../lib/message-meta";

export function AssistantMessageShell({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="openui-shell-thread-message-assistant openui-shell-thread-message-assistant--without-logo waves-assistant-message">
      <div className="openui-shell-thread-message-assistant__content">
        <div className="msg-actions-top">
          <MessageExport />
        </div>
        {children}
        {meta}
      </div>
    </div>
  );
}

export function MessageMeta({
  id,
  timestamp,
  usage,
}: {
  id?: string;
  timestamp?: number;
  usage: ReturnType<typeof extractUsage>["usage"];
}) {
  const threadId = useContext(ActiveThreadContext);
  return (
    <div className="waves-assistant-message__meta">
      <span>{fmtTime(messageTime(id, timestamp))}</span>
      {isAdmin() && (
        <span title="Tokens da geração (P=prompt, C=completion)">
          🪙 {usage ? `${usage.t} tok · P:${usage.p}/C:${usage.c}` : "0 tok"}
        </span>
      )}
      {isAdmin() && (
        <span className="waves-meta-debug" title={`Thread: ${threadId}\nMsg: ${id || "—"}`}>
          🧵 {threadId?.slice(0, 8)} · #{id?.slice(0, 8) || "—"}
        </span>
      )}
    </div>
  );
}
