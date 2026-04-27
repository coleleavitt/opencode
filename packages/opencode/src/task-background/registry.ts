import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect"
import { Log } from "@/util"
import { Config } from "../config"
import type { SessionID } from "../session/schema"
import type { BackgroundTaskEntry, BackgroundTaskSnapshot, BackgroundTaskStatus } from "./types"
import { snapshot } from "./types"
import { BackgroundTaskCapacityError, BackgroundTaskNotFoundError } from "./errors"

const log = Log.create({ service: "task-background.registry" })

const DEFAULT_CAPACITY = 8

export interface RegisterInput {
  readonly task_id: string
  readonly parent_session_id: SessionID
  readonly child_session_id: SessionID
  readonly agent_name: string
  readonly description: string
  readonly abort: AbortController
}

export interface Interface {
  readonly register: (input: RegisterInput) => Effect.Effect<BackgroundTaskSnapshot, BackgroundTaskCapacityError>
  readonly get: (taskId: string) => Effect.Effect<BackgroundTaskSnapshot | undefined>
  readonly list: (parentSessionId: SessionID) => Effect.Effect<BackgroundTaskSnapshot[]>
  readonly markCompleted: (taskId: string, result: string) => Effect.Effect<void>
  readonly markFailed: (taskId: string, error: string) => Effect.Effect<void>
  readonly markKilled: (taskId: string) => Effect.Effect<void>
  readonly cancel: (taskId: string) => Effect.Effect<void, BackgroundTaskNotFoundError>
  readonly attachFiber: (
    taskId: string,
    fiber: BackgroundTaskEntry["fiber"],
  ) => Effect.Effect<void, BackgroundTaskNotFoundError>
  readonly capacity: () => Effect.Effect<{ cap: number; current: number }>
}

interface RegistryState {
  readonly entries: Map<string, BackgroundTaskEntry>
  cap: number
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TaskBackgroundRegistry") {}

function activeCount(state: RegistryState): number {
  let n = 0
  for (const entry of state.entries.values()) if (entry.status === "running") n++
  return n
}

function applyCapacityFromConfig(state: RegistryState, raw: number | undefined) {
  state.cap = typeof raw === "number" && raw > 0 ? raw : DEFAULT_CAPACITY
}

function abortRunning(state: RegistryState, reason: string) {
  for (const entry of state.entries.values()) {
    if (entry.status !== "running") continue
    entry.status = "killed"
    entry.ended_at = Date.now()
    entry.error = reason
    try {
      entry.abort.abort(reason)
    } catch {}
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const state = yield* InstanceState.make<RegistryState>(
      Effect.fn("TaskBackgroundRegistry.state")(function* () {
        const init: RegistryState = { entries: new Map(), cap: DEFAULT_CAPACITY }
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            abortRunning(init, "Instance disposed")
            init.entries.clear()
            log.info("registry disposed")
          }),
        )
        return init
      }),
    )

    const withState = <A, E = never>(fn: (s: RegistryState) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
      InstanceState.useEffect(state, fn)

    const register: Interface["register"] = Effect.fn("TaskBackgroundRegistry.register")(function* (input) {
      const cfg = yield* config.get()
      return yield* withState((s) =>
        Effect.gen(function* () {
          applyCapacityFromConfig(s, cfg.task?.max_concurrent_background)
          if (s.entries.has(input.task_id)) {
            log.warn("register skipped: task_id already known", { task_id: input.task_id })
            return snapshot(s.entries.get(input.task_id)!)
          }
          const current = activeCount(s)
          if (current >= s.cap) {
            return yield* new BackgroundTaskCapacityError({
              cap: s.cap,
              current,
              requestedAgent: input.agent_name,
            })
          }
          const entry: BackgroundTaskEntry = {
            task_id: input.task_id,
            parent_session_id: input.parent_session_id,
            child_session_id: input.child_session_id,
            agent_name: input.agent_name,
            description: input.description,
            started_at: Date.now(),
            status: "running",
            abort: input.abort,
          }
          s.entries.set(input.task_id, entry)
          log.info("registered", { task_id: input.task_id, agent: input.agent_name, current: current + 1, cap: s.cap })
          return snapshot(entry)
        }),
      )
    })

    const get: Interface["get"] = Effect.fn("TaskBackgroundRegistry.get")(function* (taskId) {
      return yield* withState((s) =>
        Effect.sync(() => {
          const entry = s.entries.get(taskId)
          return entry ? snapshot(entry) : undefined
        }),
      )
    })

    const list: Interface["list"] = Effect.fn("TaskBackgroundRegistry.list")(function* (parentSessionId) {
      return yield* withState((s) =>
        Effect.sync(() => {
          const out: BackgroundTaskSnapshot[] = []
          for (const entry of s.entries.values()) {
            if (entry.parent_session_id === parentSessionId) out.push(snapshot(entry))
          }
          return out
        }),
      )
    })

    function transition(status: BackgroundTaskStatus) {
      return (taskId: string, payload?: { result?: string; error?: string }) =>
        withState((s) =>
          Effect.sync(() => {
            const entry = s.entries.get(taskId)
            if (!entry) {
              log.warn("transition target missing", { taskId, status })
              return
            }
            if (entry.status !== "running") return
            entry.status = status
            entry.ended_at = Date.now()
            if (payload?.result !== undefined) entry.result = payload.result
            if (payload?.error !== undefined) entry.error = payload.error
            log.info("transition", { taskId, status })
          }),
        )
    }

    const markCompletedFn = transition("completed")
    const markFailedFn = transition("failed")
    const markKilledFn = transition("killed")

    const markCompleted: Interface["markCompleted"] = Effect.fn("TaskBackgroundRegistry.markCompleted")(function* (
      taskId: string,
      result: string,
    ) {
      yield* markCompletedFn(taskId, { result })
    })
    const markFailed: Interface["markFailed"] = Effect.fn("TaskBackgroundRegistry.markFailed")(function* (
      taskId: string,
      error: string,
    ) {
      yield* markFailedFn(taskId, { error })
    })
    const markKilled: Interface["markKilled"] = Effect.fn("TaskBackgroundRegistry.markKilled")(function* (
      taskId: string,
    ) {
      yield* markKilledFn(taskId)
    })

    const cancel: Interface["cancel"] = Effect.fn("TaskBackgroundRegistry.cancel")(function* (taskId: string) {
      const exists = yield* withState((s) =>
        Effect.sync(() => {
          const entry = s.entries.get(taskId)
          if (!entry) return false
          if (entry.status === "running") {
            entry.status = "killed"
            entry.ended_at = Date.now()
            try {
              entry.abort.abort("task_cancel")
            } catch {}
          }
          return true
        }),
      )
      if (!exists) return yield* new BackgroundTaskNotFoundError({ taskId })
    })

    const attachFiber: Interface["attachFiber"] = Effect.fn("TaskBackgroundRegistry.attachFiber")(function* (
      taskId,
      fiber,
    ) {
      const ok = yield* withState((s) =>
        Effect.sync(() => {
          const entry = s.entries.get(taskId)
          if (!entry) return false
          entry.fiber = fiber
          return true
        }),
      )
      if (!ok) return yield* new BackgroundTaskNotFoundError({ taskId })
    })

    const capacity: Interface["capacity"] = Effect.fn("TaskBackgroundRegistry.capacity")(function* () {
      const cfg = yield* config.get()
      return yield* withState((s) =>
        Effect.sync(() => {
          applyCapacityFromConfig(s, cfg.task?.max_concurrent_background)
          return { cap: s.cap, current: activeCount(s) }
        }),
      )
    })

    return Service.of({
      register,
      get,
      list,
      markCompleted,
      markFailed,
      markKilled,
      cancel,
      attachFiber,
      capacity,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as TaskBackgroundRegistry from "./registry"
