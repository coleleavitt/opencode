import { Database } from "@/storage"
import type { SessionID } from "./schema"
import { Log } from "@/util"

const log = Log.create({ service: "search" })

export interface SearchResult {
  partID: string
  sessionID: string
  messageID: string
  snippet: string
  rank: number
}

type FtsRow = { part_id: string; session_id: string; message_id: string; snippet: string; rank: number }

function toResult(row: FtsRow): SearchResult {
  return {
    partID: row.part_id,
    sessionID: row.session_id,
    messageID: row.message_id,
    snippet: row.snippet,
    rank: row.rank,
  }
}

export function searchParts(query: string, options?: { sessionID?: SessionID; limit?: number }): SearchResult[] {
  const limit = options?.limit ?? 20
  const client = Database.Client().$client

  if (options?.sessionID) {
    const rows = client
      .prepare(
        `SELECT part_id, session_id, message_id,
                snippet(parts_fts, 3, '<mark>', '</mark>', '...', 32) as snippet,
                bm25(parts_fts) as rank
         FROM parts_fts
         WHERE parts_fts MATCH ? AND session_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, options.sessionID, limit) as FtsRow[]

    log.info("search", { query, results: rows.length, sessionID: options.sessionID.slice(0, 8) })
    return rows.map(toResult)
  }

  const rows = client
    .prepare(
      `SELECT part_id, session_id, message_id,
              snippet(parts_fts, 3, '<mark>', '</mark>', '...', 32) as snippet,
              bm25(parts_fts) as rank
       FROM parts_fts
       WHERE parts_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit) as FtsRow[]

  log.info("search", { query, results: rows.length })
  return rows.map(toResult)
}

export * as Search from "./search"
