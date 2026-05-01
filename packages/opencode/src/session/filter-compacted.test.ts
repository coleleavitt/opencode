import { describe, expect, test } from "bun:test"
import { filterCompacted } from "./message-v2"
import type { WithParts } from "./message-v2"
import { MessageID, SessionID } from "./schema"

const SESSION = SessionID.make("ses_test000000000000000000")

function msgID(index: number) {
  return MessageID.make(`msg_${String(index).padStart(6, "0")}`)
}

function fakeMsg(
  index: number,
  role: "user" | "assistant",
  partCount: number,
  opts?: { summary?: boolean; finish?: boolean; parentID?: string; compactionPart?: boolean },
): WithParts {
  const id = msgID(index)
  const parts = Array.from({ length: partCount }, (_, i) => ({
    id: `prt_${index}_${i}`,
    messageID: id,
    sessionID: SESSION,
    type: "text" as const,
    text: `part-${i}-${"x".repeat(100)}`,
    time: { created: Date.now(), updated: Date.now() },
  }))
  if (opts?.compactionPart) {
    parts.push({
      id: `prt_${index}_compaction`,
      messageID: id,
      sessionID: SESSION,
      type: "compaction" as const,
      auto: false,
      time: { created: Date.now(), updated: Date.now() },
    } as any)
  }
  return {
    info: {
      id,
      sessionID: SESSION,
      role,
      agent: "build",
      model: { providerID: "test", modelID: "test" },
      time: { created: Date.now() },
      parentID: opts?.parentID ?? id,
      summary: opts?.summary,
      finish: opts?.finish,
      error: undefined,
      cost: 0,
      mode: "default",
      modelID: "test",
      path: [],
      providerID: "test",
      tokens: { input: 0, output: 0 },
    } as any,
    parts: parts as any,
  }
}

function* generateMessages(count: number, partsPerMessage: number): Generator<WithParts> {
  for (let i = 0; i < count; i++) {
    yield fakeMsg(i, i % 2 === 0 ? "user" : "assistant", partsPerMessage)
  }
}

describe("filterCompacted", () => {
  test("loads all messages when no compaction marker exists", () => {
    const msgs = Array.from(generateMessages(100, 5))
    const result = filterCompacted(msgs)
    expect(result.length).toBe(100)
  })

  test("handles 600+ messages without compaction (unlace regression)", () => {
    const count = 633
    const start = performance.now()
    const msgs = Array.from(generateMessages(count, 4))
    const result = filterCompacted(msgs)
    const elapsed = performance.now() - start
    expect(result.length).toBe(count)
    expect(elapsed).toBeLessThan(1000)
  })

  test("handles 1000+ messages without compaction", () => {
    const count = 1085
    const start = performance.now()
    const msgs = Array.from(generateMessages(count, 4))
    const result = filterCompacted(msgs)
    const elapsed = performance.now() - start
    expect(result.length).toBe(count)
    expect(elapsed).toBeLessThan(2000)
  })

  test("breaks early at compaction marker", () => {
    const compactedUserID = msgID(4)
    const msgs: WithParts[] = [
      fakeMsg(0, "user", 2),
      fakeMsg(1, "assistant", 2),
      fakeMsg(2, "user", 2),
      fakeMsg(3, "assistant", 2, { summary: true, finish: true, parentID: compactedUserID }),
      fakeMsg(4, "user", 2, { compactionPart: true }),
      fakeMsg(5, "assistant", 2),
      fakeMsg(6, "user", 2),
      fakeMsg(7, "assistant", 2),
    ]

    const result = filterCompacted(msgs)
    expect(result.length).toBeLessThan(msgs.length)
  })

  test("memory stays bounded for large sessions", () => {
    const count = 2000
    const before = process.memoryUsage().heapUsed
    const msgs = Array.from(generateMessages(count, 10))
    const result = filterCompacted(msgs)
    const after = process.memoryUsage().heapUsed
    const growth = after - before
    expect(result.length).toBe(count)
    expect(growth).toBeLessThan(500 * 1024 * 1024)
  })
})
