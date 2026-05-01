import { Log } from "../util"
import { BlobTable } from "./cas.sql"
import { eq } from "drizzle-orm"
import * as Database from "./db"

const log = Log.create({ service: "cas" })

let dedupHits = 0
let dedupMisses = 0

export function hash(content: string | Buffer): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex").slice(0, 32)
}

export function store(content: string | Buffer): string {
  const h = hash(content)
  if (exists(h)) {
    dedupHits++
    log.info("store", { hash: h.slice(0, 8), dedup: true })
  } else {
    dedupMisses++
    const buf = typeof content === "string" ? Buffer.from(content) : content
    Database.use((db) => {
      db.insert(BlobTable)
        .values({
          hash: h,
          size: buf.byteLength,
          data: buf,
        })
        .onConflictDoNothing()
        .run()
    })
    log.info("store", { hash: h.slice(0, 8), size: buf.byteLength })
  }
  const total = dedupHits + dedupMisses
  if (total % 100 === 0) {
    log.info("dedup", { hits: dedupHits, misses: dedupMisses, ratio: dedupHits / total })
  }
  return h
}

export function metrics(): { hits: number; misses: number; ratio: number } {
  const total = dedupHits + dedupMisses
  return { hits: dedupHits, misses: dedupMisses, ratio: total > 0 ? dedupHits / total : 0 }
}

export function retrieve(h: string): string | null {
  return Database.use((db) => {
    const row = db.select({ data: BlobTable.data }).from(BlobTable).where(eq(BlobTable.hash, h)).get()
    if (!row) return null
    if (row.data instanceof Buffer) return row.data.toString("utf-8")
    if (row.data instanceof Uint8Array) return Buffer.from(row.data).toString("utf-8")
    return String(row.data)
  })
}

export function exists(h: string): boolean {
  return Database.use((db) => {
    const row = db.select({ _: BlobTable.hash }).from(BlobTable).where(eq(BlobTable.hash, h)).limit(1).get()
    return row !== undefined
  })
}

export * as Cas from "./cas"
