import * as Tool from "./tool"
import z from "zod"
import { Effect } from "effect"
import { TaskBackgroundRegistry } from "../task-background/registry"
import { TaskStatusCrossSessionError } from "../task-background/errors"

const id = "task_cancel"

const parameters = z.object({
  task_id: z.string().describe("The task_id of a previously launched background task."),
})

const DESCRIPTION = `Cancel a background task spawned via task(run_in_background: true).
Returns one of:
- {status: "killed"} — task was running and is now aborted
- {status: "already_completed"} — task finished successfully before the cancel arrived
- {status: "already_failed"} — task ended with an error before the cancel arrived
- {status: "unknown"} — task_id is not in the registry

Cross-session cancellation (task_id from a different parent session) yields TaskStatusCrossSessionError.`

export const TaskCancelTool = Tool.define(
  id,
  Effect.gen(function* () {
    const registry = yield* TaskBackgroundRegistry.Service

    const run = Effect.fn("TaskCancelTool.execute")(function* (
      params: z.infer<typeof parameters>,
      ctx: Tool.Context,
    ) {
      const before = yield* registry.get(params.task_id)
      if (!before) {
        return {
          title: `${params.task_id} (unknown)`,
          metadata: { task_id: params.task_id, status: "unknown" },
          output: JSON.stringify({ task_id: params.task_id, status: "unknown" }, null, 2),
        }
      }
      if (before.parent_session_id !== ctx.sessionID) {
        return yield* new TaskStatusCrossSessionError({
          taskId: params.task_id,
          callerSessionId: ctx.sessionID,
          ownerSessionId: before.parent_session_id,
        })
      }
      if (before.status === "completed") {
        return {
          title: `${params.task_id} (already_completed)`,
          metadata: { task_id: params.task_id, status: "already_completed" },
          output: JSON.stringify({ task_id: params.task_id, status: "already_completed" }, null, 2),
        }
      }
      if (before.status === "failed") {
        return {
          title: `${params.task_id} (already_failed)`,
          metadata: { task_id: params.task_id, status: "already_failed" },
          output: JSON.stringify({ task_id: params.task_id, status: "already_failed" }, null, 2),
        }
      }
      if (before.status === "killed") {
        return {
          title: `${params.task_id} (killed)`,
          metadata: { task_id: params.task_id, status: "killed" },
          output: JSON.stringify({ task_id: params.task_id, status: "killed" }, null, 2),
        }
      }
      yield* registry.cancel(params.task_id)
      return {
        title: `${params.task_id} (killed)`,
        metadata: { task_id: params.task_id, status: "killed" },
        output: JSON.stringify({ task_id: params.task_id, status: "killed" }, null, 2),
      }
    })

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
