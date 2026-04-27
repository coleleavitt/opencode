import { describe, expect, test } from "bun:test"
import { ForkContext } from "../../src/session/fork-context"
import { MessageID, PartID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"

function userMessage(text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  const sessionID = "ses_test" as MessageV2.WithParts["info"]["sessionID"]
  return {
    info: {
      id,
      role: "user",
      sessionID,
      agent: "build",
      time: { created: Date.now() },
    },
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

describe("ForkContext.truncateForBudget", () => {
  test("returns all messages when total tokens fit budget", () => {
    const messages = [userMessage("hi"), userMessage("there")]
    const result = ForkContext.truncateForBudget(messages, 1000)
    expect(result.truncated).toBe(false)
    expect(result.droppedCount).toBe(0)
    expect(result.messages).toHaveLength(2)
  })

  test("returns empty when input is empty (no marker)", () => {
    const result = ForkContext.truncateForBudget([], 100)
    expect(result.truncated).toBe(false)
    expect(result.droppedCount).toBe(0)
    expect(result.messages).toHaveLength(0)
  })

  test("drops oldest messages and prepends a truncation marker when over budget", () => {
    const big = "x".repeat(800)
    const messages = [userMessage(big), userMessage(big), userMessage(big), userMessage(big)]
    const result = ForkContext.truncateForBudget(messages, 250)
    expect(result.truncated).toBe(true)
    expect(result.droppedCount).toBeGreaterThan(0)
    const first = result.messages[0]
    expect(first?.parts[0]).toBeDefined()
    const firstText = (first!.parts[0] as MessageV2.TextPart).text
    expect(firstText).toContain("<truncated>")
    expect(firstText).toContain(`Dropped ${result.droppedCount}`)
  })

  test("returns empty (no surviving messages) when budget is zero or negative", () => {
    const messages = [userMessage("hi"), userMessage("there")]
    const zeroResult = ForkContext.truncateForBudget(messages, 0)
    expect(zeroResult.messages).toHaveLength(0)
    expect(zeroResult.truncated).toBe(true)
    expect(zeroResult.droppedCount).toBe(2)
  })

  test("estimateMessageTokens uses 4-chars-per-token heuristic", () => {
    expect(ForkContext.estimateMessageTokens(userMessage(""))).toBe(0)
    expect(ForkContext.estimateMessageTokens(userMessage("abcd"))).toBe(1)
    expect(ForkContext.estimateMessageTokens(userMessage("abcde"))).toBe(2)
  })

  test("DEFAULT_FORK_CONTEXT_BUDGET_TOKENS is exported and positive", () => {
    expect(ForkContext.DEFAULT_FORK_CONTEXT_BUDGET_TOKENS).toBeGreaterThan(0)
  })
})
