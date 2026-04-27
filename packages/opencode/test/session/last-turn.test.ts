import { describe, expect, test } from "bun:test"
import { LastTurn } from "../../src/session/last-turn"
import { MessageID, PartID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"

function msg(role: "user" | "assistant", text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  const sessionID = "ses_test" as MessageV2.WithParts["info"]["sessionID"]
  const base = {
    id,
    sessionID,
    agent: "build",
    time: { created: Date.now() },
  }
  const info =
    role === "assistant"
      ? ({ ...base, role: "assistant" } as MessageV2.Assistant)
      : ({ ...base, role: "user" } as MessageV2.User)
  return {
    info,
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID,
        type: "text",
        text,
      } as MessageV2.TextPart,
    ],
  } as MessageV2.WithParts
}

describe("LastTurn.lastTurn", () => {
  test("empty input → empty output", () => {
    expect(LastTurn.lastTurn([])).toEqual([])
  })

  test("returns from the last user message onward", () => {
    const u1 = msg("user", "u1")
    const a1 = msg("assistant", "a1")
    const u2 = msg("user", "u2")
    const a2 = msg("assistant", "a2")
    const result = LastTurn.lastTurn([u1, a1, u2, a2])
    expect(result.length).toBe(2)
    expect(result[0].info.id).toBe(u2.info.id)
    expect(result[1].info.id).toBe(a2.info.id)
  })

  test("returns whole list when there is no user message", () => {
    const a1 = msg("assistant", "a1")
    const a2 = msg("assistant", "a2")
    const result = LastTurn.lastTurn([a1, a2])
    expect(result.length).toBe(2)
  })

  test("returns from the only user message when it is first", () => {
    const u1 = msg("user", "u1")
    const a1 = msg("assistant", "a1")
    const a2 = msg("assistant", "a2")
    const result = LastTurn.lastTurn([u1, a1, a2])
    expect(result.length).toBe(3)
  })
})
