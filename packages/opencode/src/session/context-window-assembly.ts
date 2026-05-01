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

export * as ContextWindowAssembly from "./context-window-assembly"
