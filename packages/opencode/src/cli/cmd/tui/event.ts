import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
import z from "zod"

export const TuiEvent = {
  PromptAppend: BusEvent.define("tui.prompt.append", z.object({ text: z.string() })),
  CommandExecute: BusEvent.define(
    "tui.command.execute",
    z.object({
      command: z.union([
        z.enum([
          "session.list",
          "session.new",
          "session.share",
          "session.interrupt",
          "session.compact",
          "session.page.up",
          "session.page.down",
          "session.line.up",
          "session.line.down",
          "session.half.page.up",
          "session.half.page.down",
          "session.first",
          "session.last",
          "prompt.clear",
          "prompt.submit",
          "agent.cycle",
        ]),
        z.string(),
      ]),
    }),
  ),
  ToastShow: BusEvent.define(
    "tui.toast.show",
    z.object({
      title: z.string().optional(),
      message: z.string(),
      variant: z.enum(["info", "success", "warning", "error"]),
      duration: z.number().default(5000).optional().describe("Duration in milliseconds"),
    }),
  ),
  SessionSelect: BusEvent.define(
    "tui.session.select",
    z.object({
      sessionID: SessionID.zod.describe("Session ID to navigate to"),
    }),
  ),
  TaskStarted: BusEvent.define(
    "tui.task.started",
    z.object({
      task_id: z.string(),
      description: z.string(),
      agent_name: z.string(),
      is_background: z.boolean(),
      parent_session_id: z.string(),
    }),
  ),
  TaskCompleted: BusEvent.define(
    "tui.task.completed",
    z.object({
      task_id: z.string(),
      description: z.string(),
      agent_name: z.string(),
      status: z.enum(["completed", "failed", "killed"]),
      duration_ms: z.number().optional(),
      error: z.string().optional(),
    }),
  ),
}
