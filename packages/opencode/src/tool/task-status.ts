import * as Tool from "./tool"
import z from "zod"
import { Effect } from "effect"
import { TaskBackgroundRegistry } from "../task-background/registry"
import { TaskStatusCrossSessionError } from "../task-background/errors"

const id = "task_status"

const parameters = z.object({
  task_id: z.string().describe("The task_id returned by a prior `task(run_in_background: true)` invocation."),
})

const DESCRIPTION = `Inspect the status of a background task spawned via task(run_in_background: true).
Returns one of:
- {status: "running", agent_name, started_at, elapsed_ms}
- {status: "completed", agent_name, started_at, completed_at, output}
- {status: "failed", agent_name, started_at, failed_at, error}
- {status: "killed", agent_name, started_at, killed_at}
- {status: "unknown"} when the task_id is not registered.

Cross-session lookups (task_id from a different parent session) yield TaskStatusCrossSessionError.`

export const TaskStatusTool = Tool.define(
  id,
  Effect.gen(function* () {
    const registry = yield* TaskBackgroundRegistry.Service

    const run = Effect.fn("TaskStatusTool.execute")(function* (
      params: z.infer<typeof parameters>,
      ctx: Tool.Context,
    ) {
      const snap = yield* registry.get(params.task_id)
      if (!snap) {
        const body: Record<string, unknown> = { task_id: params.task_id, status: "unknown" }
        return {
          title: `${params.task_id} (unknown)`,
          metadata: body,
          output: JSON.stringify(body, null, 2),
        }
      }
      if (snap.parent_session_id !== ctx.sessionID) {
        return yield* new TaskStatusCrossSessionError({
          taskId: params.task_id,
          callerSessionId: ctx.sessionID,
          ownerSessionId: snap.parent_session_id,
        })
      }
      const now = Date.now()
      let body: Record<string, unknown>
      if (snap.status === "running") {
        body = {
          task_id: snap.task_id,
          status: "running",
          agent_name: snap.agent_name,
          started_at: snap.started_at,
          elapsed_ms: now - snap.started_at,
        }
      } else if (snap.status === "completed") {
        body = {
          task_id: snap.task_id,
          status: "completed",
          agent_name: snap.agent_name,
          started_at: snap.started_at,
          completed_at: snap.ended_at,
          output: snap.result ?? "",
        }
      } else if (snap.status === "failed") {
        body = {
          task_id: snap.task_id,
          status: "failed",
          agent_name: snap.agent_name,
          started_at: snap.started_at,
          failed_at: snap.ended_at,
          error: snap.error ?? "(no message)",
        }
      } else {
        body = {
          task_id: snap.task_id,
          status: "killed",
          agent_name: snap.agent_name,
          started_at: snap.started_at,
          killed_at: snap.ended_at,
        }
      }
      return {
        title: `${snap.agent_name} (${snap.status})`,
        metadata: body,
        output: JSON.stringify(body, null, 2),
      }
    })

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
