import {
  useThread,
} from "@openuidev/react-headless";
import {
  Shell,
  isChatEmpty,
} from "@openuidev/react-ui";
import type { ProfileStarter } from "../../api/runtime";
import type { AgentItem } from "../../types/auth";
import { useInputFormGatePending } from "../ConversationLauncher";
import { pickIcon } from "./starter-utils";

export function WelcomeArea({
  starters,
  title,
  subtitle,
  agent,
}: {
  starters: ProfileStarter[];
  title?: string;
  subtitle?: string;
  agent?: AgentItem;
}) {
  const messages = useThread((s) => s.messages);
  const isLoadingMessages = useThread((s) => s.isLoadingMessages);
  const processMessage = useThread((s) => s.processMessage);
  const isRunning = useThread((s) => s.isRunning);
  const formPending = useInputFormGatePending(agent);
  if (formPending) return null;
  if (!isChatEmpty({ isLoadingMessages, messages })) return null;

  return (
    <Shell.WelcomeScreen>
      <div className="waves-welcome">
        {title?.trim() && (
          <h2 className="waves-welcome__title">{title.trim()}</h2>
        )}
        {subtitle?.trim() && (
          <p className="waves-welcome__desc">{subtitle.trim()}</p>
        )}
        {starters.length > 0 && (
          <div className="waves-welcome__starters">
            {starters.map((s, i) => (
              <button
                key={`${s.displayText}-${i}`}
                type="button"
                className="waves-welcome__starter"
                disabled={isRunning}
                onClick={() => processMessage({ role: "user", content: s.prompt })}
              >
                <span aria-hidden>{pickIcon(s.displayText)}</span>
                <span>{s.displayText}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Shell.WelcomeScreen>
  );
}
