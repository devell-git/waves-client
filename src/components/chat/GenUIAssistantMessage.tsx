import {
  useThread,
} from "@openuidev/react-headless";
import { Renderer } from "@openuidev/react-lang";
import { isOpenUrlAllowed } from "../../lib/open-url-allowlist";
import { shadcnChatLibrary } from "../../lib/shadcn-genui";
import { AnalysisReport } from "../../lib/shadcn-genui/components/analysis-report";
import { JobProgressCard, parseCheckJob, stripJobMarker } from "../JobProgressCard";
import { extractUsage } from "../../lib/message-meta";
import { getToolProvider } from "../../lib/openui-tools";
import { stripNullArgs, parseAnalysisReport, execReportToOpenui } from "./starter-utils";
import { parseCreateTaskDirective, CreateTaskTrigger } from "./CreateTaskTrigger";
import { AssistantMessageShell, MessageMeta } from "./AssistantMessageShell";

const OPENUI_PATTERN = /\b(root\s*=|Card\s*\(|CardHeader\s*\(|TextContent\s*\(|Table\s*\(|TagBlock\s*\(|Alert\s*\(|FollowUpItem\s*\(|(?:Pie|Bar|Line)Chart\s*\(|ListBlock\s*\(|Accordion\s*\()/;

export function GenUIAssistantMessage({
  message,
}: {
  message: { id?: string; content?: string; timestamp?: number };
}) {
  const rawContent = typeof message.content === "string" ? message.content : "";
  const processMessage = useThread((s) => s.processMessage);
  const isStreaming = useThread((s) => s.isRunning);
  if (!rawContent) return null;

  const { clean: rawClean, usage } = extractUsage(rawContent);
  const meta0 = <MessageMeta id={message.id} timestamp={message.timestamp} usage={usage} />;
  const analysisReq = parseAnalysisReport(rawClean);
  if (analysisReq) {
    return (
      <AssistantMessageShell meta={meta0}>
        <AnalysisReport
          workflow_id={analysisReq.workflow_id}
          instruction={analysisReq.instruction}
          ap_number={analysisReq.ap_number}
          scope={analysisReq.scope}
        />
      </AssistantMessageShell>
    );
  }
  const execOpenui = execReportToOpenui(rawClean);
  const content = execOpenui ?? rawClean;
  const meta = <MessageMeta id={message.id} timestamp={message.timestamp} usage={usage} />;

  const createDir = parseCreateTaskDirective(content);
  if (createDir) {
    return (
      <AssistantMessageShell meta={meta}>
        <CreateTaskTrigger directive={createDir} content={content} />
      </AssistantMessageShell>
    );
  }

  const job = parseCheckJob(content);
  const bodyContent = job ? stripJobMarker(content) : content;
  const hasBody = bodyContent.trim().length > 0;
  const jobCard = job ? (
    <JobProgressCard
      jobId={job.jobId}
      etaSeconds={job.etaSeconds}
      specialist={job.specialist}
      onActionContent={(label, formState) => {
        const contentPart = label ? `<content>${label}</content>` : "";
        const ctx: unknown[] = [`User clicked: ${label ?? ""}`];
        if (formState) ctx.push(formState);
        processMessage({ role: "user", content: `${contentPart}<context>${JSON.stringify(ctx)}</context>` });
      }}
    />
  ) : null;

  if (job && !hasBody) {
    return <AssistantMessageShell meta={meta}>{jobCard}</AssistantMessageShell>;
  }

  if (!OPENUI_PATTERN.test(bodyContent)) {
    return (
      <AssistantMessageShell meta={meta}>
        <div className="assistant-plain-text" style={{
          padding: "0.75rem 1rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {bodyContent}
        </div>
        {jobCard}
      </AssistantMessageShell>
    );
  }

  return (
    <AssistantMessageShell meta={meta}>
    <Renderer
      response={stripNullArgs(bodyContent)}
      library={shadcnChatLibrary}
      isStreaming={isStreaming}
      toolProvider={getToolProvider() ?? undefined}
      onAction={(event) => {
        if (event.type === "edit_task") {
          const raw = event.params?.task_id ?? event.params?.taskId;
          const taskId = raw != null ? Number(raw) : NaN;
          if (Number.isFinite(taskId)) {
            window.dispatchEvent(
              new CustomEvent("waves:edit-task", { detail: { taskId } }),
            );
          }
          return;
        }
        if (event.type === "create_task") {
          const wf = Number(event.params?.workflow_id ?? event.params?.workflowId);
          const st = event.params?.stage_id ?? event.params?.funnel_stage_id;
          if (Number.isFinite(wf)) {
            window.dispatchEvent(
              new CustomEvent("waves:create-task", {
                detail: { workflowId: wf, stageId: st != null ? Number(st) : undefined },
              }),
            );
          }
          return;
        }
        if (event.type === "continue_conversation") {
          const contentPart = event.humanFriendlyMessage
            ? `<content>${event.humanFriendlyMessage}</content>`
            : "";
          const ctx: unknown[] = [`User clicked: ${event.humanFriendlyMessage ?? ""}`];
          if (event.formState) ctx.push(event.formState);
          processMessage({
            role: "user",
            content: `${contentPart}<context>${JSON.stringify(ctx)}</context>`,
          });
          return;
        }
        if (event.type === "open_url") {
          const rawUrl = event.params?.url;
          const url = typeof rawUrl === "string" ? rawUrl : "";
          if (isOpenUrlAllowed(url)) {
            window.open(url, "_blank", "noopener,noreferrer");
          } else if (url) {
            console.warn("[openui] open_url bloqueado (fora da allowlist):", url);
          }
        }
      }}
    />
    {jobCard}
    </AssistantMessageShell>
  );
}
