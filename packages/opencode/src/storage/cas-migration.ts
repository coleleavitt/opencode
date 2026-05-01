import * as Database from "./db"
import { Cas } from "./cas"
import { isLargePart } from "./cas-constants"
import { Log } from "@/util"

const log = Log.create({ service: "cas-migration" })

/**
 * Migrate existing large parts to the CAS blob store.
 * Scans parts without blob_hash that have large text content,
 * externalizes them, and sets blob_hash.
 *
 * Idempotent — safe to re-run. Only processes parts where blob_hash IS NULL.
 * Runs in batches to avoid holding a long transaction.
 *
 * Parts below the threshold get blob_hash set to '' (empty string) so they
 * are skipped on subsequent runs — prevents infinite re-scanning.
 */
export function migrateExistingParts(options?: {
  batchSize?: number
  onProgress?: (done: number, total: number) => void
}) {
  const batchSize = options?.batchSize ?? 1000
  const client = Database.Client().$client

  const countStmt = client.prepare("SELECT COUNT(*) as count FROM part WHERE blob_hash IS NULL")
  const selectStmt = client.prepare("SELECT id, data FROM part WHERE blob_hash IS NULL LIMIT ?")
  const updateStmt = client.prepare("UPDATE part SET blob_hash = ? WHERE id = ?")

  const total = (countStmt.get() as { count: number }).count
  log.info("migration start", { total })

  let processed = 0
  let externalized = 0
  let skipped = 0

  while (true) {
    const rows = selectStmt.all(batchSize) as { id: string; data: string }[]
    if (rows.length === 0) break

    const txn = client.transaction(() => {
      for (const row of rows) {
        processed++
        const data = JSON.parse(row.data) as Record<string, unknown>

        if (typeof data.text !== "string" || !isLargePart(data.text)) {
          // Mark as visited so it's not re-scanned (empty string = below threshold)
          updateStmt.run("", row.id)
          skipped++
          continue
        }

        const hash = Cas.store(data.text)
        updateStmt.run(hash, row.id)
        externalized++
      }
    })
    txn()

    options?.onProgress?.(processed, total)
    log.info("migration batch", { processed, externalized, skipped, total })

    if (rows.length < batchSize) break
  }

  log.info("migration complete", { processed, externalized, skipped, total })
  return { processed, externalized, skipped, total }
}

export * as CasMigration from "./cas-migration"
