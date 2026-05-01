import { Cause, Effect } from "effect"
import { Log } from "@/util"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import type { SessionID } from "../session/schema"
import type { MessageV2 } from "../session/message-v2"
import type { SessionPrompt } from "../session/prompt"
import type { TaskBackgroundRegistry } from "../task-background/registry"
import type { PendingTaskNotifications } from "../task-background/pending-notifications"
import type { TaskPromptOps } from "./task"

const log = Log.create({ service: "tool.task.async" })

export interface AsyncDispatchInput {
  readonly taskId: string
  readonly parentSessionID: SessionID
  readonly childSessionID: SessionID
  readonly agentName: string
  readonly description: string
  readonly abort: AbortController
  readonly promptInput: SessionPrompt.PromptInput
  readonly ops: TaskPromptOps
  readonly registry: TaskBackgroundRegistry.Interface
  readonly pending: PendingTaskNotifications.Interface
}

export interface AsyncLaunchResult {
  readonly status: "async_launched"
  readonly task_id: string
  readonly agent_name: string
  readonly started_at: number
}

function buildWork(input: AsyncDispatchInput) {
  const startedAt = Date.now()
  return Effect.gen(function* () {
    void Bus.publish(TuiEvent.TaskProgress, {
      task_id: input.taskId,
      description: input.description,
      elapsed_ms: 0,
    })
    const exit = yield* Effect.exit(input.ops.prompt(input.promptInput))
    if (exit._tag === "Success") {
      const reply = exit.value
      const lastText = reply.parts.findLast((p: MessageV2.Part) => p.type === "text")
      const text = lastText && lastText.type === "text" ? lastText.text : ""
      const summary = `Task "${input.description}" completed.`
      yield* input.registry.markCompleted(input.taskId, text)
      void Bus.publish(TuiEvent.TaskUpdated, {
        task_id: input.taskId,
        patch: { status: "completed", end_time: Date.now() },
      })
      const note: Omit<MessageV2.BackgroundTaskNotificationPart, "id" | "messageID" | "sessionID"> = {
        type: "background_task_notification",
        task_id: input.taskId,
        agent_name: input.agentName,
        status: "completed",
        summary,
        result: text,
        time: { start: startedAt, end: Date.now() },
      }
      yield* input.pending.enqueue(input.parentSessionID, note)
      void Bus.publish(TuiEvent.TaskCompleted, {
        task_id: input.taskId,
        description: input.description,
        agent_name: input.agentName,
        status: "completed",
        duration_ms: Date.now() - startedAt,
      })
      log.info("async task completed", { taskId: input.taskId, agent: input.agentName })
      return
    }
    const squashed = Cause.squash(exit.cause)
    const errMessage = squashed instanceof Error ? squashed.message : String(squashed)
    const aborted = input.abort.signal.aborted
    if (aborted) yield* input.registry.markKilled(input.taskId)
    else yield* input.registry.markFailed(input.taskId, errMessage)
    void Bus.publish(TuiEvent.TaskUpdated, {
      task_id: input.taskId,
      patch: {
        status: aborted ? "killed" : "failed",
        end_time: Date.now(),
        error: aborted ? undefined : errMessage,
      },
    })
    const summary = aborted
      ? `Task "${input.description}" was cancelled.`
      : `Task "${input.description}" failed: ${errMessage}.`
    const note: Omit<MessageV2.BackgroundTaskNotificationPart, "id" | "messageID" | "sessionID"> = {
      type: "background_task_notification",
      task_id: input.taskId,
      agent_name: input.agentName,
      status: aborted ? "killed" : "failed",
      summary,
      error: errMessage,
      time: { start: startedAt, end: Date.now() },
    }
    yield* input.pending.enqueue(input.parentSessionID, note)
    void Bus.publish(TuiEvent.TaskCompleted, {
      task_id: input.taskId,
      description: input.description,
      agent_name: input.agentName,
      status: aborted ? "killed" : "failed",
      duration_ms: Date.now() - startedAt,
      error: errMessage,
    })
    log.info("async task ended", { taskId: input.taskId, status: aborted ? "killed" : "failed", error: errMessage })
  })
}

export function launchAsync(input: AsyncDispatchInput): AsyncLaunchResult {
  // Lazy-import AppRuntime to break the static cycle: Agent.defaultLayer is initialized inside
  // app-runtime; importing it at module load from a tool file causes the layer to be touched
  // before initialization. Dynamic import sidesteps the hoisting order.
  void import("@/effect/app-runtime").then(({ AppRuntime }) => {
    AppRuntime.runFork(buildWork(input) as unknown as Parameters<typeof AppRuntime.runFork>[0])
  })
  return {
    status: "async_launched",
    task_id: input.taskId,
    agent_name: input.agentName,
    started_at: Date.now(),
  }
}

export * as TaskAsyncDispatch from "./task-async-dispatch"
