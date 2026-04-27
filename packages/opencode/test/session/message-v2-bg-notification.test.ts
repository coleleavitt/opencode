import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { afterEach } from "bun:test"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(Layer.mergeAll(Session.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("MessageV2.BackgroundTaskNotificationPart", () => {
  it.live("schema accepts a complete completed-status notification", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const now = Date.now()
        const part: MessageV2.BackgroundTaskNotificationPart = {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: "ses_test" as MessageV2.BackgroundTaskNotificationPart["sessionID"],
          type: "background_task_notification",
          task_id: "bg_abc123",
          agent_name: "explore",
          status: "completed",
          summary: "Found 3 files",
          result: "src/foo.ts\nsrc/bar.ts\nsrc/baz.ts",
          time: { start: now - 5000, end: now },
        }
        const decoded = Schema.decodeUnknownSync(MessageV2.Part)(part)
        expect(decoded.type).toBe("background_task_notification")
        if (decoded.type !== "background_task_notification") return
        expect(decoded.status).toBe("completed")
        expect(decoded.task_id).toBe("bg_abc123")
        expect(decoded.result).toBe("src/foo.ts\nsrc/bar.ts\nsrc/baz.ts")
      }),
    ),
  )

  it.live("schema accepts failed status with error field", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const now = Date.now()
        const part: MessageV2.BackgroundTaskNotificationPart = {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: "ses_test" as MessageV2.BackgroundTaskNotificationPart["sessionID"],
          type: "background_task_notification",
          task_id: "bg_failed",
          agent_name: "general",
          status: "failed",
          summary: "Provider returned 503",
          error: "ProviderTransportError: 503 Service Unavailable",
          time: { start: now - 1000, end: now },
        }
        const decoded = Schema.decodeUnknownSync(MessageV2.Part)(part)
        if (decoded.type !== "background_task_notification") return
        expect(decoded.status).toBe("failed")
        expect(decoded.error).toContain("ProviderTransportError")
      }),
    ),
  )

  it.live("schema rejects invalid status values", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const now = Date.now()
        const bad = {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: "ses_test",
          type: "background_task_notification",
          task_id: "bg_bad",
          agent_name: "general",
          status: "running",
          summary: "x",
          time: { start: now, end: now },
        }
        expect(() => Schema.decodeUnknownSync(MessageV2.Part)(bad)).toThrow()
      }),
    ),
  )

  it.live("round-trips through Session.updatePart and Session.getPart", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Round-trip" })

        const messageID = MessageID.ascending()
        const assistant: MessageV2.Assistant = {
          id: messageID,
          role: "assistant",
          parentID: messageID,
          sessionID: chat.id,
          mode: "build",
          agent: "build",
          cost: 0,
          path: { cwd: "/tmp", root: "/tmp" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          time: { created: Date.now() },
        }
        yield* sessions.updateMessage(assistant)

        const now = Date.now()
        const partID = PartID.ascending()
        const part: MessageV2.BackgroundTaskNotificationPart = {
          id: partID,
          messageID,
          sessionID: chat.id,
          type: "background_task_notification",
          task_id: "bg_roundtrip",
          agent_name: "explore",
          status: "completed",
          summary: "ok",
          result: "result text",
          time: { start: now - 100, end: now },
        }
        yield* sessions.updatePart(part)

        const fetched = yield* sessions.getPart({ sessionID: chat.id, messageID, partID })
        expect(fetched).toBeDefined()
        if (!fetched) return
        expect(fetched.type).toBe("background_task_notification")
        if (fetched.type !== "background_task_notification") return
        expect(fetched.task_id).toBe("bg_roundtrip")
        expect(fetched.status).toBe("completed")
        expect(fetched.result).toBe("result text")
        expect(fetched.summary).toBe("ok")
        expect(fetched.time.start).toBe(now - 100)
        expect(fetched.time.end).toBe(now)
      }),
    ),
  )
})
