import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
import { TaskBackgroundRegistry } from "../../src/task-background/registry"
import { TaskStatusCrossSessionError } from "../../src/task-background/errors"
import { PendingTaskNotifications } from "../../src/task-background/pending-notifications"
import { TaskStatusTool } from "../../src/tool/task-status"
import { TaskCancelTool } from "../../src/tool/task-cancel"
import { Truncate } from "../../src/tool"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    PendingTaskNotifications.defaultLayer,
    Provider.defaultLayer,
    Session.defaultLayer,
    TaskBackgroundRegistry.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

function ctxFor(sessionID: SessionID) {
  return {
    sessionID,
    messageID: "msg_test_xxxxxxxxxxxxxxxxxxxxxx" as never,
    agent: "build",
    abort: new AbortController().signal,
    extra: {},
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

describe("task_status tool", () => {
  it.live("returns running status with elapsed_ms while task is in flight", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskBackgroundRegistry.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "parent" })
        const child = yield* sessions.create({ parentID: parent.id, title: "child" })
        yield* reg.register({
          task_id: child.id,
          parent_session_id: parent.id,
          child_session_id: child.id,
          agent_name: "explore",
          description: "test",
          abort: new AbortController(),
        })

        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const result = yield* def.execute({ task_id: child.id }, ctxFor(parent.id))
        const parsed = JSON.parse(result.output)
        expect(parsed.status).toBe("running")
        expect(parsed.agent_name).toBe("explore")
        expect(typeof parsed.elapsed_ms).toBe("number")
      }),
    ),
  )

  it.live("returns completed status with output once markCompleted is called", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskBackgroundRegistry.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "parent" })
        const child = yield* sessions.create({ parentID: parent.id, title: "child" })
        yield* reg.register({
          task_id: child.id,
          parent_session_id: parent.id,
          child_session_id: child.id,
          agent_name: "explore",
          description: "test",
          abort: new AbortController(),
        })
        yield* reg.markCompleted(child.id, "the result")

        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const result = yield* def.execute({ task_id: child.id }, ctxFor(parent.id))
        const parsed = JSON.parse(result.output)
        expect(parsed.status).toBe("completed")
        expect(parsed.output).toBe("the result")
      }),
    ),
  )

  it.live("returns failed status with error", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskBackgroundRegistry.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "parent" })
        const child = yield* sessions.create({ parentID: parent.id, title: "child" })
        yield* reg.register({
          task_id: child.id,
          parent_session_id: parent.id,
          child_session_id: child.id,
          agent_name: "explore",
          description: "test",
          abort: new AbortController(),
        })
        yield* reg.markFailed(child.id, "boom")

        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const result = yield* def.execute({ task_id: child.id }, ctxFor(parent.id))
        const parsed = JSON.parse(result.output)
        expect(parsed.status).toBe("failed")
        expect(parsed.error).toBe("boom")
      }),
    ),
  )

  it.live("returns unknown for non-registered task_id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "parent" })
        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const result = yield* def.execute({ task_id: "ses_does_not_exist_xxxxxxxxxxxxx" }, ctxFor(parent.id))
        const parsed = JSON.parse(result.output)
        expect(parsed.status).toBe("unknown")
      }),
    ),
  )

  it.live("yields TaskStatusCrossSessionError when caller is a different parent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskBackgroundRegistry.Service
        const sessions = yield* Session.Service
        const ownerParent = yield* sessions.create({ title: "owner" })
        const fooParent = yield* sessions.create({ title: "foo" })
        const child = yield* sessions.create({ parentID: ownerParent.id, title: "child" })
        yield* reg.register({
          task_id: child.id,
          parent_session_id: ownerParent.id,
          child_session_id: child.id,
          agent_name: "explore",
          description: "test",
          abort: new AbortController(),
        })

        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const exit = yield* Effect.exit(def.execute({ task_id: child.id }, ctxFor(fooParent.id)))
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        const err = Cause.squash(exit.cause)
        expect(err).toBeInstanceOf(TaskStatusCrossSessionError)
      }),
    ),
  )
})

describe("task_cancel tool", () => {
  it.live("cancels a running task and reflects killed status", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskBackgroundRegistry.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "parent" })
        const child = yield* sessions.create({ parentID: parent.id, title: "child" })
        const ac = new AbortController()
        yield* reg.register({
          task_id: child.id,
          parent_session_id: parent.id,
          child_session_id: child.id,
          agent_name: "explore",
          description: "test",
          abort: ac,
        })

        const tool = yield* TaskCancelTool
        const def = yield* tool.init()
        const result = yield* def.execute({ task_id: child.id }, ctxFor(parent.id))
        const parsed = JSON.parse(result.output)
        expect(parsed.status).toBe("killed")
        expect(ac.signal.aborted).toBe(true)

        const after = yield* reg.get(child.id)
        expect(after?.status).toBe("killed")
      }),
    ),
  )

  it.live("returns already_completed when task already finished", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskBackgroundRegistry.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "parent" })
        const child = yield* sessions.create({ parentID: parent.id, title: "child" })
        yield* reg.register({
          task_id: child.id,
          parent_session_id: parent.id,
          child_session_id: child.id,
          agent_name: "explore",
          description: "test",
          abort: new AbortController(),
        })
        yield* reg.markCompleted(child.id, "ok")

        const tool = yield* TaskCancelTool
        const def = yield* tool.init()
        const result = yield* def.execute({ task_id: child.id }, ctxFor(parent.id))
        const parsed = JSON.parse(result.output)
        expect(parsed.status).toBe("already_completed")
      }),
    ),
  )

  it.live("returns unknown for never-registered task_id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "parent" })
        const tool = yield* TaskCancelTool
        const def = yield* tool.init()
        const result = yield* def.execute({ task_id: "ses_doesnt_exist_xxxxxxxxxxxx" }, ctxFor(parent.id))
        const parsed = JSON.parse(result.output)
        expect(parsed.status).toBe("unknown")
      }),
    ),
  )

  it.live("yields TaskStatusCrossSessionError when caller is a different parent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskBackgroundRegistry.Service
        const sessions = yield* Session.Service
        const ownerParent = yield* sessions.create({ title: "owner" })
        const fooParent = yield* sessions.create({ title: "foo" })
        const child = yield* sessions.create({ parentID: ownerParent.id, title: "child" })
        yield* reg.register({
          task_id: child.id,
          parent_session_id: ownerParent.id,
          child_session_id: child.id,
          agent_name: "explore",
          description: "test",
          abort: new AbortController(),
        })

        const tool = yield* TaskCancelTool
        const def = yield* tool.init()
        const exit = yield* Effect.exit(def.execute({ task_id: child.id }, ctxFor(fooParent.id)))
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        expect(Cause.squash(exit.cause)).toBeInstanceOf(TaskStatusCrossSessionError)
      }),
    ),
  )
})


