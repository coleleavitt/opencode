import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Service as Registry, defaultLayer } from "../../src/task-background/registry"
import { BackgroundTaskCapacityError, BackgroundTaskNotFoundError } from "../../src/task-background/errors"
import { SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(defaultLayer, CrossSpawnSpawner.defaultLayer))

function makeInput(opts: {
  task_id?: string
  agent_name?: string
  parent?: SessionID
  child?: SessionID
}) {
  return {
    task_id: opts.task_id ?? `bg_${Math.random().toString(36).slice(2, 8)}`,
    parent_session_id: opts.parent ?? (SessionID.make("ses_parent_x" as string)),
    child_session_id: opts.child ?? (SessionID.make("ses_child_x" as string)),
    agent_name: opts.agent_name ?? "general",
    description: "test task",
    abort: new AbortController(),
  }
}

describe("BackgroundTaskRegistry", () => {
  it.live("registers a new task in running status", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        const snap = yield* reg.register(makeInput({ task_id: "bg_run1" }))
        expect(snap.task_id).toBe("bg_run1")
        expect(snap.status).toBe("running")
        expect(snap.started_at).toBeGreaterThan(0)
        expect(snap.ended_at).toBeUndefined()
      }),
    ),
  )

  it.live("get returns undefined for unknown task ids", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        const result = yield* reg.get("bg_unknown")
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("list filters entries by parent_session_id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        const parentA = SessionID.make("ses_parentA_xxxxxxxxxxxxxx" as string)
        const parentB = SessionID.make("ses_parentB_xxxxxxxxxxxxxx" as string)
        yield* reg.register(makeInput({ task_id: "bg_a1", parent: parentA }))
        yield* reg.register(makeInput({ task_id: "bg_a2", parent: parentA }))
        yield* reg.register(makeInput({ task_id: "bg_b1", parent: parentB }))

        const a = yield* reg.list(parentA)
        const b = yield* reg.list(parentB)
        expect(a.map((e) => e.task_id).sort()).toEqual(["bg_a1", "bg_a2"])
        expect(b.map((e) => e.task_id)).toEqual(["bg_b1"])
      }),
    ),
  )

  it.live("markCompleted transitions running → completed and stores result", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        yield* reg.register(makeInput({ task_id: "bg_done" }))
        yield* reg.markCompleted("bg_done", "the result text")
        const snap = yield* reg.get("bg_done")
        expect(snap?.status).toBe("completed")
        expect(snap?.result).toBe("the result text")
        expect(snap?.ended_at).toBeGreaterThan(0)
      }),
    ),
  )

  it.live("markFailed transitions running → failed and stores error", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        yield* reg.register(makeInput({ task_id: "bg_err" }))
        yield* reg.markFailed("bg_err", "kaboom")
        const snap = yield* reg.get("bg_err")
        expect(snap?.status).toBe("failed")
        expect(snap?.error).toBe("kaboom")
      }),
    ),
  )

  it.live("cancel aborts running task and marks killed", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        const input = makeInput({ task_id: "bg_kill" })
        yield* reg.register(input)
        yield* reg.cancel("bg_kill")
        const snap = yield* reg.get("bg_kill")
        expect(snap?.status).toBe("killed")
        expect(input.abort.signal.aborted).toBe(true)
      }),
    ),
  )

  it.live("cancel of unknown task fails with typed error", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        const exit = yield* Effect.exit(reg.cancel("bg_nope"))
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        const cancelErr = Cause.squash(exit.cause)
        expect(cancelErr).toBeInstanceOf(BackgroundTaskNotFoundError)
      }),
    ),
  )

  it.live("transitions are idempotent: second markCompleted is a no-op", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        yield* reg.register(makeInput({ task_id: "bg_idem" }))
        yield* reg.markCompleted("bg_idem", "first")
        yield* reg.markCompleted("bg_idem", "second")
        const snap = yield* reg.get("bg_idem")
        expect(snap?.result).toBe("first")
      }),
    ),
  )

  it.live("capacity cap rejects 9th launch with typed error (default 8)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        for (let i = 0; i < 8; i++) {
          yield* reg.register(makeInput({ task_id: `bg_${i}` }))
        }
        const cap = yield* reg.capacity()
        expect(cap.cap).toBe(8)
        expect(cap.current).toBe(8)

        const overflow = yield* Effect.exit(reg.register(makeInput({ task_id: "bg_overflow" })))
        expect(overflow._tag).toBe("Failure")
        if (overflow._tag !== "Failure") return
        const err = Cause.squash(overflow.cause)
        expect(err).toBeInstanceOf(BackgroundTaskCapacityError)
        if (!(err instanceof BackgroundTaskCapacityError)) return
        expect(err.cap).toBe(8)
        expect(err.current).toBe(8)
      }),
    ),
  )

  it.live("freeing a slot via markCompleted allows a new launch", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* Registry
        for (let i = 0; i < 8; i++) {
          yield* reg.register(makeInput({ task_id: `bg_${i}` }))
        }
        yield* reg.markCompleted("bg_0", "ok")
        const next = yield* reg.register(makeInput({ task_id: "bg_after_free" }))
        expect(next.task_id).toBe("bg_after_free")
        expect(next.status).toBe("running")
      }),
    ),
  )
})
