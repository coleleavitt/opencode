import type { MessageV2 } from "./message-v2"

export function lastTurn(messages: ReadonlyArray<MessageV2.WithParts>): MessageV2.WithParts[] {
  if (messages.length === 0) return []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === "user") return messages.slice(i)
  }
  return [...messages]
}

export * as LastTurn from "./last-turn"
