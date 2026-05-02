import { Database, desc, eq, inArray } from "@/storage"
import { MessageTable, PartTable } from "./session.sql"
import type { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Cas } from "@/storage/cas"
import { Log } from "@/util"

const log = Log.create({ service: "context-window-assembly" })

/**
 * Load the last k messages with their parts for a session.
 * O(k) query — only loads what the LLM needs, not the entire session.
 * Returns messages in chronological order (oldest first).
 */
export function assembleContextWindow(sessionID: SessionID, k: number): MessageV2.WithParts[] {
  const messageRows = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(eq(MessageTable.session_id, sessionID))
      .orderBy(desc(MessageTable.time_created))
      .limit(k)
      .all(),
  )

  if (messageRows.length === 0) return []

  const messageIds = messageRows.map((r) => r.id)

  const partRows = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(inArray(PartTable.message_id, messageIds))
      .orderBy(PartTable.message_id, PartTable.id)
      .all(),
  )

  const partsByMessage = new Map<string, MessageV2.Part[]>()
  for (const row of partRows) {
    const next = {
      ...row.data,
      id: row.id,
      sessionID: row.session_id,
      messageID: row.message_id,
    } as MessageV2.Part
    if (row.blob_hash && (next.type === "text" || next.type === "reasoning") && !next.text) {
      const content = Cas.retrieve(row.blob_hash)
      if (content) (next as MessageV2.TextPart | MessageV2.ReasoningPart).text = content
    }
    const list = partsByMessage.get(row.message_id)
    if (list) list.push(next)
    else partsByMessage.set(row.message_id, [next])
  }

  const result: MessageV2.WithParts[] = messageRows.map((row) => ({
    info: {
      ...row.data,
      id: row.id,
      sessionID: row.session_id,
    } as MessageV2.Info,
    parts: partsByMessage.get(row.id) ?? [],
  }))

  // result is newest-first; filterCompacted expects newest-first and returns oldest-first
  const filtered = MessageV2.filterCompacted(result)

  log.info("assembled", { sessionID: sessionID.slice(0, 8), k, loaded: filtered.length })
  return filtered
}

const MICROCOMPACT_PROTECTED = new Set(["skill"])
const MICROCOMPACT_PROTECTION_BUDGET = 100_000
const MICROCOMPACT_HYSTERESIS = 30_000
const MICROCOMPACT_PROTECTED_TURNS = 2

/**
 * In-memory tool output pruning via token-budget backward scan.
 * Protects last N user→assistant turns unconditionally, then fills a token
 * budget with the most recent tool results beyond that. Everything that
 * doesn't fit gets `time.compacted = -1` so toModelMessages emits
 * "[Old tool result content cleared]". Hysteresis prevents thrashing.
 * DB and TUI unaffected — assembleContextWindow loads fresh each iteration.
 */
export function microcompact(msgs: MessageV2.WithParts[]): MessageV2.WithParts[] {
  // Phase 1: find turn protection boundary
  let turnsFound = 0
  let boundary = msgs.length
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].info.role === "user") turnsFound++
    if (turnsFound > MICROCOMPACT_PROTECTED_TURNS) {
      boundary = i + 1
      break
    }
  }
  if (turnsFound <= MICROCOMPACT_PROTECTED_TURNS) return msgs

  // Phase 2: backward scan through unprotected region, fill token budget
  const candidates: { msgIdx: number; partIdx: number; tokens: number }[] = []
  let budgetUsed = 0
  let prunableTokens = 0

  for (let i = boundary - 1; i >= 0; i--) {
    for (let j = msgs[i].parts.length - 1; j >= 0; j--) {
      const part = msgs[i].parts[j]
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (part.state.time.compacted) continue
      if (MICROCOMPACT_PROTECTED.has(part.tool)) continue
      const tokens = part.state.output.length / 4
      if (budgetUsed + tokens <= MICROCOMPACT_PROTECTION_BUDGET) {
        budgetUsed += tokens
        continue
      }
      candidates.push({ msgIdx: i, partIdx: j, tokens })
      prunableTokens += tokens
    }
  }

  // Phase 3: hysteresis — don't bother unless prunable is significant
  if (prunableTokens < MICROCOMPACT_HYSTERESIS) return msgs

  // Phase 4: clear
  for (const c of candidates) {
    const part = msgs[c.msgIdx].parts[c.partIdx]
    if (part.type !== "tool" || part.state.status !== "completed") continue
    part.state.output = ""
    part.state.time.compacted = -1
    part.state.attachments = undefined
  }

  return msgs
}

export * as ContextWindowAssembly from "./context-window-assembly"
