import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "../config"
import { Provider } from "../provider"
import { Effect } from "effect"
import { Flag } from "@/flag/flag"
import { Log } from "@/util"
import { lastTurn } from "../session/last-turn"
import { TaskBackgroundRegistry } from "../task-background/registry"
import { PendingTaskNotifications } from "../task-background/pending-notifications"
import { TaskAsyncDispatch } from "./task-async-dispatch"
import { RecursiveForkError, TaskNotAssistantMessageError, TaskOpsMissingError, UnknownAgentError } from "./task-errors"

const log = Log.create({ service: "tool.task" })

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

const FORK_AGENT_NAME = "fork"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z
    .string()
    .describe(
      "The type of specialized agent to use for this task. Omit to spawn an implicit fork that inherits the parent's full conversation context. Forks cannot be spawned from inside a fork.",
    )
    .optional(),
  category: z
    .string()
    .describe(
      "Display-only label persisted on the tool_use when a plugin task tool dispatches by category instead of subagent_type. Not used for routing in the native tool.",
    )
    .optional(),
  task_id: z
    .string()
    .describe(
      "Pass a prior task_id to resume the same subagent session instead of creating a fresh one. Unknown task_ids fall through to a new session with a logged warning.",
    )
    .optional(),
  model: z
    .string()
    .describe(
      'Optional per-call model override in "providerID/modelID" form (e.g. "anthropic/claude-opus-4-5"). Takes precedence over the agent definition\'s configured model. If omitted, uses the agent definition\'s model, or inherits from the parent.',
    )
    .optional(),
  run_in_background: z
    .boolean()
    .describe(
      "When true, dispatches the subagent as a fire-and-forget background task. Returns immediately with task_id; the parent receives a notification on the next user turn. Disabled when OPENCODE_DISABLE_BACKGROUND_TASKS env var is set.",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service
    const registry = yield* TaskBackgroundRegistry.Service
    const pending = yield* PendingTaskNotifications.Service

    const run = Effect.fn("TaskTool.execute")(function* (params: z.infer<typeof parameters>, ctx: Tool.Context) {
      const cfg = yield* config.get()

      const isFork = !params.subagent_type || params.subagent_type.trim().length === 0
      if (isFork) {
        const parent = yield* agent.get(ctx.agent)
        if (parent?.forks_parent_context) {
          return yield* new RecursiveForkError({ parentAgent: ctx.agent })
        }
      }
      const targetAgentName = isFork ? FORK_AGENT_NAME : params.subagent_type!

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [targetAgentName],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: targetAgentName,
          },
        })
      }

      const next = yield* agent.get(targetAgentName)
      if (!next) {
        const all = yield* agent.list()
        const available = all.filter((a) => a.hidden !== true).map((a) => a.name)
        return yield* new UnknownAgentError({ requested: targetAgentName, available })
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      if (taskID && !session) {
        log.warn("task_id did not resolve to an existing session; creating a new child session", {
          task_id: taskID,
          subagent_type: params.subagent_type,
        })
      }
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* new TaskNotAssistantMessageError({ role: msg.info.role })

      const overrideRef = params.model ? Provider.parseModel(params.model) : undefined
      if (overrideRef) {
        yield* provider.getModel(overrideRef.providerID, overrideRef.modelID)
      }
      const model = overrideRef ??
        next.model ?? {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const opsMaybe = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!opsMaybe) return yield* new TaskOpsMissingError()
      const ops = opsMaybe

      const messageID = MessageID.ascending()

      function cancel() {
        ops.cancel(nextSession.id)
      }

      const forkContextMessages = next.forks_parent_context
        ? next.forks_parent_context === "turn"
          ? lastTurn(ctx.messages)
          : [...ctx.messages]
        : undefined

      const wantsBackground = params.run_in_background === true && !Flag.OPENCODE_DISABLE_BACKGROUND_TASKS
      if (wantsBackground) {
        const bgAbort = new AbortController()
        yield* registry.register({
          task_id: nextSession.id,
          parent_session_id: ctx.sessionID,
          child_session_id: nextSession.id,
          agent_name: next.name,
          description: params.description,
          abort: bgAbort,
        })
        const parts = yield* ops.resolvePromptParts(params.prompt)
        const promptInput: SessionPrompt.PromptInput = {
          messageID,
          sessionID: nextSession.id,
          model: { modelID: model.modelID, providerID: model.providerID },
          agent: next.name,
          tools: {
            ...(canTodo ? {} : { todowrite: false }),
            ...(canTask ? {} : { task: false }),
            ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
          },
          parts,
          ...(forkContextMessages !== undefined ? { forkContextMessages } : {}),
        }
        const launch = TaskAsyncDispatch.launchAsync({
          taskId: nextSession.id,
          parentSessionID: ctx.sessionID,
          childSessionID: nextSession.id,
          agentName: next.name,
          description: params.description,
          abort: bgAbort,
          promptInput,
          ops,
          registry,
          pending,
        })
        log.info("background task launched", {
          task_id: launch.task_id,
          agent_name: launch.agent_name,
          parent_session_id: ctx.sessionID,
        })
        return {
          title: params.description,
          metadata: {
            sessionId: nextSession.id,
            model,
            background: true,
            task_id: launch.task_id,
          },
          output: [
            `task_id: ${launch.task_id}`,
            `agent: ${launch.agent_name}`,
            `started_at: ${launch.started_at}`,
            "",
            `Status: async_launched. The task is running in the background. You will receive a notification on the next user turn when it completes (or use task_status to poll).`,
          ].join("\n"),
        }
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const result = yield* ops.prompt({
              messageID,
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              agent: next.name,
              tools: {
                ...(canTodo ? {} : { todowrite: false }),
                ...(canTask ? {} : { task: false }),
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
              },
              parts,
              ...(forkContextMessages !== undefined ? { forkContextMessages } : {}),
            })

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
              ].join("\n"),
            }
          }),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    })

    return {
      description: DESCRIPTION,
      parameters,
      aliases: ["agent"] as const,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

export { RecursiveForkError, UnknownAgentError, TaskOpsMissingError, TaskNotAssistantMessageError } from "./task-errors"
