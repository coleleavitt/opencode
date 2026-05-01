#!/usr/bin/env bun
/**
 * Run CAS migration to externalize large parts (>4KB) to the blob store.
 *
 * Usage: bun run scripts/run-cas-migration.ts
 *
 * This script:
 * 1. Opens the database (applies any pending schema migrations)
 * 2. Scans parts without blob_hash that have large text content
 * 3. Externalizes them to the blobs tables with SHA-256 content addressing
 * 4. Sets blob_hash on the part row
 *
 * Safe to re-run (idempotent).
 */

// Import to trigger database initialization (migrations, FTS5 table, etc.)
import "../src/storage/db"
import { migrateExistingParts } from "../src/storage/cas-migration"

console.log("Starting CAS migration...")
console.log(`Database: ${process.env.OPENCODE_DB || "default"}`)
console.log("")

const start = performance.now()
const result = migrateExistingParts({
  batchSize: 5000,
  onProgress: (done, total) => {
    const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0"
    process.stdout.write(`\r  Progress: ${done}/${total} (${pct}%)`)
  },
})
const duration = ((performance.now() - start) / 1000).toFixed(1)

console.log("")
console.log("")
console.log("Migration complete!")
console.log(`  Total parts: ${result.total}`)
console.log(`  Processed: ${result.processed}`)
console.log(`  Externalized (>4KB): ${result.externalized}`)
console.log(`  Skipped (<4KB): ${result.skipped}`)
console.log(`  Duration: ${duration}s`)
