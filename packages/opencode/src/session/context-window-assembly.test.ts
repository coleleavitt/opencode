import { describe, test, expect, beforeAll, afterAll } from "bun:test"

// OPENCODE_DB must be set before any import that triggers Database.Client()
process.env.OPENCODE_DB = ":memory:"

import { assembleContextWindow } from "./context-window-assembly"
import { MessageV2 } from "./message-v2"
import { MessageTable, PartTable, SessionTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { BlobTable } from "../storage/cas.sql"
import * as Database from "../storage/db"
import { eq } from "drizzle-orm"
import { Cas } from "../storage/cas"
import { BLOB_THRESHOLD, isLargePart } from "../storage/cas-constants"
import { SessionID, MessageID, PartID } from "./schema"

const PROJECT_ID = "prj_test000000000000000000" as any
const SESSION = SessionID.make("ses_test000000000000000000")

function insertProject() {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: PROJECT_ID,
        worktree: "/tmp/test",
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run(),
  )
}

function insertSession(sessionID: SessionID) {
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: PROJECT_ID,
        slug: "test-session",
        directory: "/tmp/test",
        title: "Test Session",
        version: "1",
      })
      .onConflictDoNothing()
      .run(),
  )
}

function insertMessage(
  id: MessageID,
  index: number,
  role: "user" | "assistant",
  sessionID: SessionID,
  created: number,
) {
  Database.use((db) =>
    db
      .insert(MessageTable)
      .values({
        id,
        session_id: sessionID,
        data: {
          role,
          time: { created },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          ...(role === "assistant"
            ? {
                parentID: MessageID.make(`msg_parent_${String(index - 1).padStart(14, "0")}`),
                modelID: "test",
                providerID: "test",
                mode: "default",
                path: { cwd: "/tmp", root: "/tmp" },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              }
            : {}),
        } as any,
      })
      .run(),
  )
}

function insertPart(partId: PartID, messageId: MessageID, sessionID: SessionID, text: string, blobHash?: string) {
  Database.use((db) =>
    db
      .insert(PartTable)
      .values({
        id: partId,
        message_id: messageId,
        session_id: sessionID,
        data: { type: "text", text: blobHash ? "" : text } as any,
        blob_hash: blobHash ?? null,
      })
      .run(),
  )
}

beforeAll(() => {
  Database.Client()
  insertProject()
  insertSession(SESSION)
})

afterAll(() => {
  Database.close()
})

describe("assembleContextWindow", () => {
  test("returns empty array for session with no messages", () => {
    const sid = SessionID.make("ses_empty00000000000000000")
    insertSession(sid)
    expect(assembleContextWindow(sid, 10)).toEqual([])
  })

  test("returns all messages when k >= N", () => {
    const sid = SessionID.make("ses_allmsgs0000000000000000")
    insertSession(sid)
    for (let i = 0; i < 5; i++) {
      const id = MessageID.make(`msg_all_${String(i).padStart(20, "0")}`)
      insertMessage(id, i, i % 2 === 0 ? "user" : "assistant", sid, Date.now() + i * 1000)
      insertPart(PartID.make(`prt_all_${i}_0`), id, sid, `message-${i}`)
    }
    expect(assembleContextWindow(sid, 100).length).toBe(5)
  })

  test("returns messages in chronological order (oldest first)", () => {
    const sid = SessionID.make("ses_chrono000000000000000000")
    insertSession(sid)
    for (let i = 0; i < 4; i++) {
      const id = MessageID.make(`msg_chrono_${String(i).padStart(18, "0")}`)
      insertMessage(id, i, i % 2 === 0 ? "user" : "assistant", sid, 1000000 + i * 1000)
      insertPart(PartID.make(`prt_chrono_${i}_0`), id, sid, `text-${i}`)
    }
    const result = assembleContextWindow(sid, 10)
    expect(result.length).toBe(4)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].info.time.created).toBeLessThan(result[i + 1].info.time.created)
    }
  })

  test("parts are loaded for each message", () => {
    const sid = SessionID.make("ses_parts00000000000000000")
    insertSession(sid)
    const mID = MessageID.make("msg_parts_000000000000000000")
    insertMessage(mID, 0, "user", sid, Date.now())
    for (let p = 0; p < 3; p++) {
      insertPart(PartID.make(`prt_parts_0_${p}`), mID, sid, `part-${p}`)
    }
    const result = assembleContextWindow(sid, 10)
    expect(result.length).toBe(1)
    expect(result[0].parts.length).toBe(3)
    const texts = result[0].parts.map((p: any) => p.text)
    expect(texts).toContain("part-0")
    expect(texts).toContain("part-1")
    expect(texts).toContain("part-2")
  })

  test("bounded loading: request 10 from 100 messages", () => {
    const sid = SessionID.make("ses_bounded0000000000000000")
    insertSession(sid)
    for (let i = 0; i < 100; i++) {
      const id = MessageID.make(`msg_bounded_${String(i).padStart(16, "0")}`)
      insertMessage(id, i, i % 2 === 0 ? "user" : "assistant", sid, 2000000 + i * 1000)
      insertPart(PartID.make(`prt_bounded_${i}_0`), id, sid, `bounded-msg-${i}`)
    }
    const result = assembleContextWindow(sid, 10)
    expect(result.length).toBe(10)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].info.time.created).toBeLessThan(result[i + 1].info.time.created)
    }
  })

  test("resolves CAS blob content for externalized parts", () => {
    const sid = SessionID.make("ses_casblo000000000000000000")
    insertSession(sid)
    const content = "x".repeat(5000)
    const h = Cas.store(content)
    const mID = MessageID.make("msg_casblo_00000000000000000")
    insertMessage(mID, 0, "user", sid, Date.now())
    insertPart(PartID.make("prt_casblo_0_0"), mID, sid, "", h)
    const result = assembleContextWindow(sid, 10)
    expect(result.length).toBe(1)
    expect((result[0].parts[0] as any).text).toBe(content)
  })
})

describe("CAS round-trip", () => {
  test("store and retrieve returns same content", () => {
    const content = "Hello, this is test content for CAS round-trip"
    const h = Cas.store(content)
    expect(typeof h).toBe("string")
    expect(h.length).toBe(32)
    expect(Cas.retrieve(h)).toBe(content)
  })

  test("retrieve returns null for unknown hash", () => {
    expect(Cas.retrieve("00000000000000000000000000000000")).toBeNull()
  })

  test("exists returns true for stored content", () => {
    const h = Cas.store("exists-check-content")
    expect(Cas.exists(h)).toBe(true)
  })

  test("exists returns false for unknown hash", () => {
    expect(Cas.exists("ffffffffffffffffffffffffffffffff")).toBe(false)
  })

  test("hash is deterministic", () => {
    const content = "deterministic-hash-test"
    expect(Cas.hash(content)).toBe(Cas.hash(content))
  })

  test("dedup: storing same content twice creates only one blob row", () => {
    const content = "dedup-test-content-unique-" + Date.now()
    const h1 = Cas.store(content)
    const h2 = Cas.store(content)
    expect(h1).toBe(h2)
    const rows = Database.use((db) => db.select().from(BlobTable).where(eq(BlobTable.hash, h1)).all())
    expect(rows.length).toBe(1)
  })

  test("large content round-trip (> BLOB_THRESHOLD)", () => {
    const content = "A".repeat(BLOB_THRESHOLD + 1000)
    const h = Cas.store(content)
    expect(Cas.retrieve(h)).toBe(content)
  })
})

describe("isLargePart", () => {
  test("BLOB_THRESHOLD is 4096 bytes", () => {
    expect(BLOB_THRESHOLD).toBe(4096)
  })

  test("returns false for content under threshold", () => {
    expect(isLargePart("x".repeat(100))).toBe(false)
  })

  test("returns false for content exactly at threshold", () => {
    expect(isLargePart("x".repeat(4096))).toBe(false)
  })

  test("returns true for content over threshold", () => {
    expect(isLargePart("x".repeat(4097))).toBe(true)
  })

  test("uses byte length not character count (multi-byte chars)", () => {
    expect(isLargePart("😀".repeat(1025))).toBe(true)
    expect(isLargePart("😀".repeat(1024))).toBe(false)
  })
})

describe("hydrate blob resolution", () => {
  test("page() resolves blob content for externalized parts", () => {
    const sid = SessionID.make("ses_hydblob00000000000000000")
    insertSession(sid)
    const content = "hydrate-blob-resolution-test-content-" + "x".repeat(5000)
    const h = Cas.store(content)
    const mID = MessageID.make("msg_hydblob_0000000000000000")
    insertMessage(mID, 0, "user", sid, Date.now())
    insertPart(PartID.make("prt_hydblob_0_0"), mID, sid, "", h)
    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    expect((result.items[0].parts[0] as any).text).toBe(content)
  })

  test("page() preserves inline text when no blob_hash", () => {
    const sid = SessionID.make("ses_hydnoblob000000000000000")
    insertSession(sid)
    const mID = MessageID.make("msg_hydnoblob_00000000000000")
    insertMessage(mID, 0, "user", sid, Date.now())
    insertPart(PartID.make("prt_hydnob_0_0"), mID, sid, "inline-text")
    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    expect((result.items[0].parts[0] as any).text).toBe("inline-text")
  })
})
