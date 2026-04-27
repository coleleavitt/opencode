import type { MessageV2 } from "./message-v2"

const CHARS_PER_TOKEN_HEURISTIC = 4

const TRUNCATION_MARKER_TEXT =
  "<truncated>Earlier parent-session messages dropped to fit the fork-context token budget. Newer messages preserved.</truncated>"

export interface ForkContextTruncationResult {
  readonly messages: MessageV2.WithParts[]
  readonly truncated: boolean
  readonly droppedCount: number
}

export function estimateMessageTokens(message: MessageV2.WithParts): number {
  let chars = 0
  for (const part of message.parts) {
    if (part.type === "text" && typeof part.text === "string") chars += part.text.length
    else if (part.type === "tool" && part.state.status === "completed" && typeof part.state.output === "string") {
      chars += part.state.output.length
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_HEURISTIC)
}

function makeTruncationMarker(droppedCount: number): MessageV2.WithParts {
  const now = Date.now()
  const sessionID = "fork-truncation-marker" as MessageV2.WithParts["info"]["sessionID"]
  const id = ("fork-truncation-" + now.toString(36)) as MessageV2.WithParts["info"]["id"]
  return {
    info: {
      id,
      role: "user",
      sessionID,
      agent: "fork",
      time: { created: now },
    },
    parts: [
      {
        id: ("fork-truncation-part-" + now.toString(36)) as MessageV2.Part["id"],
        messageID: id,
        sessionID,
        type: "text",
        text: `${TRUNCATION_MARKER_TEXT} (Dropped ${droppedCount} message${droppedCount === 1 ? "" : "s"} from the start.)`,
      } as MessageV2.TextPart,
    ],
  } as MessageV2.WithParts
}

export function truncateForBudget(
  messages: ReadonlyArray<MessageV2.WithParts>,
  budgetTokens: number,
): ForkContextTruncationResult {
  if (messages.length === 0) return { messages: [], truncated: false, droppedCount: 0 }
  if (budgetTokens <= 0) return { messages: [], truncated: messages.length > 0, droppedCount: messages.length }

  const tokensPerMessage = messages.map((m) => estimateMessageTokens(m))
  let total = tokensPerMessage.reduce((sum, n) => sum + n, 0)
  if (total <= budgetTokens) return { messages: [...messages], truncated: false, droppedCount: 0 }

  let dropped = 0
  let cursor = 0
  while (cursor < messages.length && total > budgetTokens) {
    total -= tokensPerMessage[cursor]
    cursor++
    dropped++
  }
  const surviving = messages.slice(cursor)
  if (dropped === 0) return { messages: [...surviving], truncated: false, droppedCount: 0 }

  return { messages: [makeTruncationMarker(dropped), ...surviving], truncated: true, droppedCount: dropped }
}

export const DEFAULT_FORK_CONTEXT_BUDGET_TOKENS = 100_000

export * as ForkContext from "./fork-context"
