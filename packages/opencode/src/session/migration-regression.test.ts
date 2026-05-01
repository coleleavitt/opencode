import { describe, test, expect, beforeAll, afterAll } from "bun:test"

// OPENCODE_DB must be set before any import that triggers Database.Client()
process.env.OPENCODE_DB = ":memory:"

import { MessageV2 } from "./message-v2"
import { assembleContextWindow } from "./context-window-assembly"
import { MessageTable, PartTable, SessionTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import * as Database from "../storage/db"
import { Cas } from "../storage/cas"
import { SessionID, MessageID, PartID } from "./schema"

// ── Shared constants ─────────────────────────────────────────────────────────

const PROJECT_ID = "prj_migr000000000000000000" as any
const NOW = 1700000000000

// ── Helpers ──────────────────────────────────────────────────────────────────

function insertProject() {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({ id: PROJECT_ID, worktree: "/tmp/test", sandboxes: [] })
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
  extra?: Record<string, unknown>,
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
          ...extra,
        } as any,
      })
      .run(),
  )
}

/**
 * Insert a part with explicit control over blob_hash state.
 * @param blobHash - null (new part), '' (migrated small), or '<hash>' (migrated large)
 */
function insertPart(
  partId: PartID,
  messageId: MessageID,
  sessionID: SessionID,
  data: Record<string, unknown>,
  blobHash: string | null,
) {
  Database.use((db) =>
    db
      .insert(PartTable)
      .values({
        id: partId,
        message_id: messageId,
        session_id: sessionID,
        data: data as any,
        blob_hash: blobHash,
      })
      .run(),
  )
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(() => {
  Database.Client()
  insertProject()
})

afterAll(() => {
  Database.close()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1: page() — TUI message loading path
// ═══════════════════════════════════════════════════════════════════════════════

describe("page() — TUI message loading path", () => {
  test("returns parts with blob_hash = NULL (new parts)", () => {
    const sid = SessionID.make("ses_pg_null0000000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pg_null0000000000000000")
    insertMessage(mid, 0, "user", sid, NOW)
    insertPart(PartID.make("prt_pg_null_0_0"), mid, sid, { type: "text", text: "new part text" }, null)

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    expect(result.items[0].parts.length).toBe(1)
    const p = result.items[0].parts[0] as MessageV2.TextPart
    expect(p.type).toBe("text")
    expect(p.text).toBe("new part text")
  })

  test("returns parts with blob_hash = '' (migrated small parts)", () => {
    const sid = SessionID.make("ses_pg_empty000000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pg_empty000000000000000")
    insertMessage(mid, 0, "user", sid, NOW + 1000)
    insertPart(PartID.make("prt_pg_empty_0_0"), mid, sid, { type: "text", text: "migrated small text" }, "")

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    expect(result.items[0].parts.length).toBe(1)
    const p = result.items[0].parts[0] as MessageV2.TextPart
    expect(p.type).toBe("text")
    expect(p.text).toBe("migrated small text")
  })

  test("returns parts with blob_hash = '<hash>' and inline text present", () => {
    const sid = SessionID.make("ses_pg_hash_inl00000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pg_hash_inl00000000000")
    insertMessage(mid, 0, "user", sid, NOW + 2000)
    const longText = "x".repeat(5000)
    const h = Cas.store(longText)
    // Inline text is STILL PRESENT (matches production state)
    insertPart(PartID.make("prt_pg_hash_i_0"), mid, sid, { type: "text", text: longText }, h)

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    const p = result.items[0].parts[0] as MessageV2.TextPart
    expect(p.type).toBe("text")
    expect(p.text).toBe(longText)
  })

  test("returns parts with blob_hash = '<hash>' and inline text cleared (future migration)", () => {
    const sid = SessionID.make("ses_pg_hash_clr00000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pg_hash_clr00000000000")
    insertMessage(mid, 0, "user", sid, NOW + 3000)
    const content = "blob-only content " + "y".repeat(5000)
    const h = Cas.store(content)
    // Inline text cleared — blob resolution must kick in
    insertPart(PartID.make("prt_pg_hash_c_0"), mid, sid, { type: "text", text: "" }, h)

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    const p = result.items[0].parts[0] as MessageV2.TextPart
    expect(p.type).toBe("text")
    expect(p.text).toBe(content)
  })

  test("returns non-text parts (tool, step-start, step-finish) with blob_hash = ''", () => {
    const sid = SessionID.make("ses_pg_nontext0000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pg_nontext0000000000000")
    insertMessage(mid, 0, "assistant", sid, NOW + 4000)

    insertPart(PartID.make("prt_pg_nontx_0ss"), mid, sid, { type: "step-start" }, "")
    insertPart(
      PartID.make("prt_pg_nontx_1tl"),
      mid,
      sid,
      {
        type: "tool",
        tool: "bash",
        callID: "call_1",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "file.txt",
          title: "bash",
          metadata: {},
          time: { start: 123, end: 456 },
        },
      },
      "",
    )
    insertPart(
      PartID.make("prt_pg_nontx_2sf"),
      mid,
      sid,
      {
        type: "step-finish",
        reason: "end_turn",
        cost: 0.01,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      "",
    )

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    expect(result.items[0].parts.length).toBe(3)
    expect(result.items[0].parts[0].type).toBe("step-start")
    expect(result.items[0].parts[1].type).toBe("tool")
    expect(result.items[0].parts[2].type).toBe("step-finish")
  })

  test("returns mixed parts (text + tool) in correct order with blob_hash = ''", () => {
    const sid = SessionID.make("ses_pg_mixed00000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pg_mixed00000000000000")
    insertMessage(mid, 0, "assistant", sid, NOW + 5000)

    insertPart(PartID.make("prt_pg_mix_0_ss"), mid, sid, { type: "step-start" }, "")
    insertPart(PartID.make("prt_pg_mix_1_tx"), mid, sid, { type: "text", text: "assistant response" }, "")
    insertPart(
      PartID.make("prt_pg_mix_2_tl"),
      mid,
      sid,
      {
        type: "tool",
        tool: "bash",
        callID: "call_2",
        state: {
          status: "completed",
          input: {},
          output: "done",
          title: "bash",
          metadata: {},
          time: { start: 100, end: 200 },
        },
      },
      "",
    )
    insertPart(PartID.make("prt_pg_mix_3_tx"), mid, sid, { type: "text", text: "more text" }, "")

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    expect(result.items[0].parts.length).toBe(4)
    expect(result.items[0].parts[0].type).toBe("step-start")
    expect(result.items[0].parts[1].type).toBe("text")
    expect((result.items[0].parts[1] as MessageV2.TextPart).text).toBe("assistant response")
    expect(result.items[0].parts[2].type).toBe("tool")
    expect(result.items[0].parts[3].type).toBe("text")
    expect((result.items[0].parts[3] as MessageV2.TextPart).text).toBe("more text")
  })

  test("with limit returns correct number of messages", () => {
    const sid = SessionID.make("ses_pg_limit00000000000000")
    insertSession(sid)
    for (let i = 0; i < 5; i++) {
      const mid = MessageID.make(`msg_pg_limit_${String(i).padStart(14, "0")}`)
      insertMessage(mid, i, i % 2 === 0 ? "user" : "assistant", sid, NOW + 6000 + i * 1000)
      insertPart(PartID.make(`prt_pg_lim_${i}_0`), mid, sid, { type: "text", text: `msg-${i}` }, "")
    }

    const result = MessageV2.page({ sessionID: sid, limit: 3 })
    // page() returns the NEWEST 3 messages (limit+1 query, then slices)
    expect(result.items.length).toBe(3)
    expect(result.more).toBe(true)
  })

  test("with cursor pagination works with migrated data", () => {
    const sid = SessionID.make("ses_pg_cursor0000000000000")
    insertSession(sid)
    for (let i = 0; i < 6; i++) {
      const mid = MessageID.make(`msg_pg_cursor_${String(i).padStart(13, "0")}`)
      insertMessage(mid, i, i % 2 === 0 ? "user" : "assistant", sid, NOW + 20000 + i * 1000)
      insertPart(PartID.make(`prt_pg_cur_${i}_0`), mid, sid, { type: "text", text: `cursor-msg-${i}` }, "")
    }

    const page1 = MessageV2.page({ sessionID: sid, limit: 3 })
    expect(page1.items.length).toBe(3)
    expect(page1.more).toBe(true)
    expect(page1.cursor).toBeDefined()

    const page2 = MessageV2.page({ sessionID: sid, limit: 3, before: page1.cursor })
    expect(page2.items.length).toBe(3)
    // All parts should have text
    for (const msg of [...page1.items, ...page2.items]) {
      for (const p of msg.parts) {
        if (p.type === "text") {
          expect((p as MessageV2.TextPart).text).toBeTruthy()
        }
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2: stream() — full session iteration
// ═══════════════════════════════════════════════════════════════════════════════

describe("stream() — full session iteration", () => {
  test("yields all messages with blob_hash = '' parts", () => {
    const sid = SessionID.make("ses_st_empty00000000000000")
    insertSession(sid)
    for (let i = 0; i < 4; i++) {
      const mid = MessageID.make(`msg_st_empty_${String(i).padStart(14, "0")}`)
      insertMessage(mid, i, i % 2 === 0 ? "user" : "assistant", sid, NOW + 30000 + i * 1000)
      insertPart(PartID.make(`prt_st_emp_${i}_0`), mid, sid, { type: "text", text: `stream-${i}` }, "")
    }

    const messages = Array.from(MessageV2.stream(sid))
    expect(messages.length).toBe(4)
    // stream() yields newest-first
    for (const msg of messages) {
      expect(msg.parts.length).toBeGreaterThan(0)
      const p = msg.parts[0] as MessageV2.TextPart
      expect(p.type).toBe("text")
      expect(p.text).toBeTruthy()
    }
  })

  test("yields messages in newest-first order", () => {
    const sid = SessionID.make("ses_st_order00000000000000")
    insertSession(sid)
    for (let i = 0; i < 3; i++) {
      const mid = MessageID.make(`msg_st_order_${String(i).padStart(14, "0")}`)
      insertMessage(mid, i, i % 2 === 0 ? "user" : "assistant", sid, NOW + 40000 + i * 1000)
      insertPart(PartID.make(`prt_st_ord_${i}_0`), mid, sid, { type: "text", text: `order-${i}` }, "")
    }

    const messages = Array.from(MessageV2.stream(sid))
    expect(messages.length).toBe(3)
    // stream() yields newest first
    for (let i = 0; i < messages.length - 1; i++) {
      expect(messages[i].info.time.created).toBeGreaterThan(messages[i + 1].info.time.created)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3: parts() — single message part loading
// ═══════════════════════════════════════════════════════════════════════════════

describe("parts() — single message part loading", () => {
  test("returns parts with blob_hash = NULL", () => {
    const sid = SessionID.make("ses_pt_null0000000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pt_null0000000000000000")
    insertMessage(mid, 0, "user", sid, NOW + 50000)
    insertPart(PartID.make("prt_pt_null_0_0"), mid, sid, { type: "text", text: "null hash text" }, null)

    const result = MessageV2.parts(mid)
    expect(result.length).toBe(1)
    expect((result[0] as MessageV2.TextPart).text).toBe("null hash text")
  })

  test("returns parts with blob_hash = ''", () => {
    const sid = SessionID.make("ses_pt_empty000000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pt_empty000000000000000")
    insertMessage(mid, 0, "user", sid, NOW + 51000)
    insertPart(PartID.make("prt_pt_empty_0_0"), mid, sid, { type: "text", text: "empty hash text" }, "")

    const result = MessageV2.parts(mid)
    expect(result.length).toBe(1)
    expect((result[0] as MessageV2.TextPart).text).toBe("empty hash text")
  })

  test("returns parts with blob_hash = '<hash>' and inline text", () => {
    const sid = SessionID.make("ses_pt_hash_inl00000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pt_hash_inl00000000000")
    insertMessage(mid, 0, "user", sid, NOW + 52000)
    const longText = "inline-present-" + "z".repeat(5000)
    const h = Cas.store(longText)
    insertPart(PartID.make("prt_pt_hash_i_0"), mid, sid, { type: "text", text: longText }, h)

    const result = MessageV2.parts(mid)
    expect(result.length).toBe(1)
    expect((result[0] as MessageV2.TextPart).text).toBe(longText)
  })

  test("returns parts with blob_hash = '<hash>' and no inline text (resolves from blob)", () => {
    const sid = SessionID.make("ses_pt_hash_clr00000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pt_hash_clr00000000000")
    insertMessage(mid, 0, "user", sid, NOW + 53000)
    const content = "blob-resolved-" + "w".repeat(5000)
    const h = Cas.store(content)
    insertPart(PartID.make("prt_pt_hash_c_0"), mid, sid, { type: "text", text: "" }, h)

    const result = MessageV2.parts(mid)
    expect(result.length).toBe(1)
    expect((result[0] as MessageV2.TextPart).text).toBe(content)
  })

  test("returns reasoning parts with blob_hash = ''", () => {
    const sid = SessionID.make("ses_pt_reason0000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pt_reason0000000000000")
    insertMessage(mid, 0, "assistant", sid, NOW + 54000)
    insertPart(
      PartID.make("prt_pt_reas_0_0"),
      mid,
      sid,
      { type: "reasoning", text: "thinking about it...", time: { start: 123 } },
      "",
    )

    const result = MessageV2.parts(mid)
    expect(result.length).toBe(1)
    expect(result[0].type).toBe("reasoning")
    expect((result[0] as MessageV2.ReasoningPart).text).toBe("thinking about it...")
  })

  test("returns reasoning parts with blob_hash = '<hash>' and no inline text", () => {
    const sid = SessionID.make("ses_pt_reas_blob0000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_pt_reas_blob0000000000")
    insertMessage(mid, 0, "assistant", sid, NOW + 55000)
    const reasoning = "deep reasoning " + "r".repeat(5000)
    const h = Cas.store(reasoning)
    insertPart(PartID.make("prt_pt_rblob_0"), mid, sid, { type: "reasoning", text: "", time: { start: 123 } }, h)

    const result = MessageV2.parts(mid)
    expect(result.length).toBe(1)
    expect(result[0].type).toBe("reasoning")
    expect((result[0] as MessageV2.ReasoningPart).text).toBe(reasoning)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4: filterCompacted() — compaction boundary detection
// ═══════════════════════════════════════════════════════════════════════════════

describe("filterCompacted() — compaction boundary detection", () => {
  test("works with blob_hash = '' parts", () => {
    const sid = SessionID.make("ses_fc_empty00000000000000")
    insertSession(sid)
    for (let i = 0; i < 4; i++) {
      const mid = MessageID.make(`msg_fc_empty_${String(i).padStart(14, "0")}`)
      insertMessage(mid, i, i % 2 === 0 ? "user" : "assistant", sid, NOW + 60000 + i * 1000)
      insertPart(PartID.make(`prt_fc_emp_${i}_0`), mid, sid, { type: "text", text: `compact-${i}` }, "")
    }

    // stream() yields newest-first, which is what filterCompacted expects
    const result = MessageV2.filterCompacted(MessageV2.stream(sid))
    expect(result.length).toBe(4)
    // filterCompacted reverses to oldest-first
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].info.time.created).toBeLessThan(result[i + 1].info.time.created)
    }
    // All text parts should have content
    for (const msg of result) {
      for (const p of msg.parts) {
        if (p.type === "text") {
          expect((p as MessageV2.TextPart).text).toBeTruthy()
        }
      }
    }
  })

  test("works with mixed blob_hash states", () => {
    const sid = SessionID.make("ses_fc_mixed00000000000000")
    insertSession(sid)

    // Message 0: user with blob_hash = null
    const mid0 = MessageID.make("msg_fc_mixed_0000000000000")
    insertMessage(mid0, 0, "user", sid, NOW + 70000)
    insertPart(PartID.make("prt_fc_mix_0_0"), mid0, sid, { type: "text", text: "null hash" }, null)

    // Message 1: assistant with blob_hash = ''
    const mid1 = MessageID.make("msg_fc_mixed_0000000000001")
    insertMessage(mid1, 1, "assistant", sid, NOW + 71000)
    insertPart(PartID.make("prt_fc_mix_1_0"), mid1, sid, { type: "text", text: "empty hash" }, "")

    // Message 2: user with blob_hash = '<hash>' and inline text
    const mid2 = MessageID.make("msg_fc_mixed_0000000000002")
    insertMessage(mid2, 2, "user", sid, NOW + 72000)
    const longText = "long-" + "a".repeat(5000)
    const h = Cas.store(longText)
    insertPart(PartID.make("prt_fc_mix_2_0"), mid2, sid, { type: "text", text: longText }, h)

    // Message 3: assistant with blob_hash = ''
    const mid3 = MessageID.make("msg_fc_mixed_0000000000003")
    insertMessage(mid3, 3, "assistant", sid, NOW + 73000)
    insertPart(PartID.make("prt_fc_mix_3_0"), mid3, sid, { type: "text", text: "another empty hash" }, "")

    const result = MessageV2.filterCompacted(MessageV2.stream(sid))
    expect(result.length).toBe(4)
    expect((result[0].parts[0] as MessageV2.TextPart).text).toBe("null hash")
    expect((result[1].parts[0] as MessageV2.TextPart).text).toBe("empty hash")
    expect((result[2].parts[0] as MessageV2.TextPart).text).toBe(longText)
    expect((result[3].parts[0] as MessageV2.TextPart).text).toBe("another empty hash")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Group 5: assembleContextWindow() — O(k) context loading
// ═══════════════════════════════════════════════════════════════════════════════

describe("assembleContextWindow() — O(k) context loading", () => {
  test("works with blob_hash = '' parts", () => {
    const sid = SessionID.make("ses_cw_empty00000000000000")
    insertSession(sid)
    for (let i = 0; i < 4; i++) {
      const mid = MessageID.make(`msg_cw_empty_${String(i).padStart(14, "0")}`)
      insertMessage(mid, i, i % 2 === 0 ? "user" : "assistant", sid, NOW + 80000 + i * 1000)
      insertPart(PartID.make(`prt_cw_emp_${i}_0`), mid, sid, { type: "text", text: `cw-${i}` }, "")
    }

    const result = assembleContextWindow(sid, 10)
    expect(result.length).toBe(4)
    for (const msg of result) {
      for (const p of msg.parts) {
        if (p.type === "text") {
          expect((p as MessageV2.TextPart).text).toBeTruthy()
        }
      }
    }
  })

  test("works with mixed blob_hash states", () => {
    const sid = SessionID.make("ses_cw_mixed00000000000000")
    insertSession(sid)

    const mid0 = MessageID.make("msg_cw_mixed_0000000000000")
    insertMessage(mid0, 0, "user", sid, NOW + 90000)
    insertPart(PartID.make("prt_cw_mix_0_0"), mid0, sid, { type: "text", text: "cw null" }, null)

    const mid1 = MessageID.make("msg_cw_mixed_0000000000001")
    insertMessage(mid1, 1, "assistant", sid, NOW + 91000)
    insertPart(PartID.make("prt_cw_mix_1_0"), mid1, sid, { type: "text", text: "cw empty" }, "")

    const mid2 = MessageID.make("msg_cw_mixed_0000000000002")
    insertMessage(mid2, 2, "user", sid, NOW + 92000)
    const content = "cw-blob-" + "b".repeat(5000)
    const h = Cas.store(content)
    insertPart(PartID.make("prt_cw_mix_2_0"), mid2, sid, { type: "text", text: content }, h)

    const result = assembleContextWindow(sid, 10)
    expect(result.length).toBe(3)
    expect((result[0].parts[0] as MessageV2.TextPart).text).toBe("cw null")
    expect((result[1].parts[0] as MessageV2.TextPart).text).toBe("cw empty")
    expect((result[2].parts[0] as MessageV2.TextPart).text).toBe(content)
  })

  test("resolves blob when inline text is cleared", () => {
    const sid = SessionID.make("ses_cw_blobonly000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_cw_blobonly000000000000")
    insertMessage(mid, 0, "user", sid, NOW + 93000)
    const content = "cw-blob-only-" + "c".repeat(5000)
    const h = Cas.store(content)
    insertPart(PartID.make("prt_cw_blob_0_0"), mid, sid, { type: "text", text: "" }, h)

    const result = assembleContextWindow(sid, 10)
    expect(result.length).toBe(1)
    expect((result[0].parts[0] as MessageV2.TextPart).text).toBe(content)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Group 6: get() — single message loading
// ═══════════════════════════════════════════════════════════════════════════════

describe("get() — single message loading", () => {
  test("returns message with blob_hash = '' parts", () => {
    const sid = SessionID.make("ses_get_empty0000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_get_empty0000000000000")
    insertMessage(mid, 0, "user", sid, NOW + 100000)
    insertPart(PartID.make("prt_get_emp_0_0"), mid, sid, { type: "text", text: "get empty hash" }, "")

    const result = MessageV2.get({ sessionID: sid, messageID: mid })
    expect(result.parts.length).toBe(1)
    expect((result.parts[0] as MessageV2.TextPart).text).toBe("get empty hash")
  })

  test("returns message with blob_hash = '<hash>' parts (inline text present)", () => {
    const sid = SessionID.make("ses_get_hash_inl0000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_get_hash_inl0000000000")
    insertMessage(mid, 0, "user", sid, NOW + 101000)
    const longText = "get-hash-inline-" + "d".repeat(5000)
    const h = Cas.store(longText)
    insertPart(PartID.make("prt_get_hi_0_0"), mid, sid, { type: "text", text: longText }, h)

    const result = MessageV2.get({ sessionID: sid, messageID: mid })
    expect(result.parts.length).toBe(1)
    expect((result.parts[0] as MessageV2.TextPart).text).toBe(longText)
  })

  test("returns message with blob_hash = '<hash>' parts (inline text cleared)", () => {
    const sid = SessionID.make("ses_get_hash_clr0000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_get_hash_clr0000000000")
    insertMessage(mid, 0, "user", sid, NOW + 102000)
    const content = "get-blob-resolved-" + "e".repeat(5000)
    const h = Cas.store(content)
    insertPart(PartID.make("prt_get_hc_0_0"), mid, sid, { type: "text", text: "" }, h)

    const result = MessageV2.get({ sessionID: sid, messageID: mid })
    expect(result.parts.length).toBe(1)
    expect((result.parts[0] as MessageV2.TextPart).text).toBe(content)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Group 7: Serialization — JSON round-trip (API response)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Serialization — JSON round-trip (API response)", () => {
  test("JSON.stringify/parse of WithParts with blob_hash = '' preserves text", () => {
    const sid = SessionID.make("ses_json_empty000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_json_empty000000000000")
    insertMessage(mid, 0, "user", sid, NOW + 110000)
    insertPart(PartID.make("prt_json_emp_0_0"), mid, sid, { type: "text", text: "json empty hash" }, "")

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    const serialized = JSON.stringify(result.items)
    const deserialized = JSON.parse(serialized) as MessageV2.WithParts[]

    expect(deserialized.length).toBe(1)
    expect(deserialized[0].parts.length).toBe(1)
    const p = deserialized[0].parts[0] as MessageV2.TextPart
    expect(p.type).toBe("text")
    expect(p.text).toBe("json empty hash")
  })

  test("JSON.stringify/parse of WithParts with blob_hash = NULL preserves text", () => {
    const sid = SessionID.make("ses_json_null0000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_json_null0000000000000")
    insertMessage(mid, 0, "user", sid, NOW + 111000)
    insertPart(PartID.make("prt_json_nul_0_0"), mid, sid, { type: "text", text: "json null hash" }, null)

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    const serialized = JSON.stringify(result.items)
    const deserialized = JSON.parse(serialized) as MessageV2.WithParts[]

    expect(deserialized.length).toBe(1)
    expect(deserialized[0].parts[0].type).toBe("text")
    expect((deserialized[0].parts[0] as MessageV2.TextPart).text).toBe("json null hash")
  })

  test("JSON.stringify/parse of WithParts with blob_hash = '<hash>' preserves text", () => {
    const sid = SessionID.make("ses_json_hash0000000000000")
    insertSession(sid)
    const mid = MessageID.make("msg_json_hash0000000000000")
    insertMessage(mid, 0, "user", sid, NOW + 112000)
    const longText = "json-hash-" + "f".repeat(5000)
    const h = Cas.store(longText)
    insertPart(PartID.make("prt_json_hsh_0_0"), mid, sid, { type: "text", text: longText }, h)

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    const serialized = JSON.stringify(result.items)
    const deserialized = JSON.parse(serialized) as MessageV2.WithParts[]

    expect(deserialized.length).toBe(1)
    expect((deserialized[0].parts[0] as MessageV2.TextPart).text).toBe(longText)
  })

  test("JSON round-trip preserves all part types with blob_hash = ''", () => {
    const sid = SessionID.make("ses_json_alltypes000000000")
    insertSession(sid)

    const umid = MessageID.make("msg_json_alltypes_0_user00")
    insertMessage(umid, 0, "user", sid, NOW + 113000)
    insertPart(PartID.make("prt_json_at_0u_fl"), umid, sid, { type: "file", mime: "image/png", url: "data:image/png;base64,abc", filename: "test.png" }, "")
    insertPart(PartID.make("prt_json_at_0u_tx"), umid, sid, { type: "text", text: "user text" }, "")

    const amid = MessageID.make("msg_json_alltypes_1_asst00")
    insertMessage(amid, 1, "assistant", sid, NOW + 114000)
    insertPart(PartID.make("prt_json_at_1a_0s"), amid, sid, { type: "step-start" }, "")
    insertPart(PartID.make("prt_json_at_1a_1t"), amid, sid, { type: "text", text: "assistant text" }, "")
    insertPart(
      PartID.make("prt_json_at_1a_2l"),
      amid,
      sid,
      {
        type: "tool",
        tool: "bash",
        callID: "call_json",
        state: {
          status: "completed",
          input: { command: "echo hi" },
          output: "hi",
          title: "bash",
          metadata: {},
          time: { start: 100, end: 200 },
        },
      },
      "",
    )
    insertPart(
      PartID.make("prt_json_at_1a_3f"),
      amid,
      sid,
      {
        type: "step-finish",
        reason: "end_turn",
        cost: 0.01,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      "",
    )

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    const serialized = JSON.stringify(result.items)
    const deserialized = JSON.parse(serialized) as MessageV2.WithParts[]

    expect(deserialized.length).toBe(2)

    const userIdx = deserialized.findIndex((m) => m.info.role === "user")
    const asstIdx = deserialized.findIndex((m) => m.info.role === "assistant")
    expect(userIdx).not.toBe(-1)
    expect(asstIdx).not.toBe(-1)

    expect(deserialized[userIdx].parts.length).toBe(2)
    expect(deserialized[userIdx].parts.some((p) => p.type === "text" && (p as MessageV2.TextPart).text === "user text")).toBe(true)
    expect(deserialized[userIdx].parts.some((p) => p.type === "file")).toBe(true)

    expect(deserialized[asstIdx].parts.length).toBe(4)
    expect(deserialized[asstIdx].parts.some((p) => p.type === "step-start")).toBe(true)
    expect(deserialized[asstIdx].parts.some((p) => p.type === "text" && (p as MessageV2.TextPart).text === "assistant text")).toBe(true)
    expect(deserialized[asstIdx].parts.some((p) => p.type === "tool")).toBe(true)
    expect(deserialized[asstIdx].parts.some((p) => p.type === "step-finish")).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Group 8: Edge cases — empty text, missing blob, multiple parts per message
// ═══════════════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  test("blob_hash = '<hash>' with missing blob and no inline text returns empty text", () => {
    const sid = SessionID.make("ses_edge_missing_blob00000")
    insertSession(sid)
    const mid = MessageID.make("msg_edge_missing_blob00000")
    insertMessage(mid, 0, "user", sid, NOW + 120000)
    // Hash that doesn't exist in CAS, inline text cleared
    insertPart(PartID.make("prt_edge_mb_0_0"), mid, sid, { type: "text", text: "" }, "deadbeefdeadbeefdeadbeefdeadbeef")

    const result = MessageV2.parts(mid)
    expect(result.length).toBe(1)
    // Text should be empty since blob doesn't exist and inline is cleared
    expect((result[0] as MessageV2.TextPart).text).toBe("")
  })

  test("multiple text parts per message with different blob_hash states", () => {
    const sid = SessionID.make("ses_edge_multi_parts000000")
    insertSession(sid)
    const mid = MessageID.make("msg_edge_multi_parts000000")
    insertMessage(mid, 0, "assistant", sid, NOW + 121000)

    // Part 1: blob_hash = null
    insertPart(PartID.make("prt_edge_mp_0_0"), mid, sid, { type: "text", text: "part-null" }, null)
    // Part 2: blob_hash = ''
    insertPart(PartID.make("prt_edge_mp_0_1"), mid, sid, { type: "text", text: "part-empty" }, "")
    // Part 3: blob_hash = '<hash>' with inline text
    const longText = "part-hash-" + "g".repeat(5000)
    const h = Cas.store(longText)
    insertPart(PartID.make("prt_edge_mp_0_2"), mid, sid, { type: "text", text: longText }, h)

    const result = MessageV2.parts(mid)
    expect(result.length).toBe(3)
    expect((result[0] as MessageV2.TextPart).text).toBe("part-null")
    expect((result[1] as MessageV2.TextPart).text).toBe("part-empty")
    expect((result[2] as MessageV2.TextPart).text).toBe(longText)
  })

  test("page() with session containing only non-text parts with blob_hash = ''", () => {
    const sid = SessionID.make("ses_edge_only_tools0000000")
    insertSession(sid)
    const mid = MessageID.make("msg_edge_only_tools0000000")
    insertMessage(mid, 0, "assistant", sid, NOW + 122000)
    insertPart(
      PartID.make("prt_edge_ot_0_0"),
      mid,
      sid,
      {
        type: "tool",
        tool: "bash",
        callID: "call_edge",
        state: {
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp",
          title: "bash",
          metadata: {},
          time: { start: 100, end: 200 },
        },
      },
      "",
    )

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    expect(result.items[0].parts.length).toBe(1)
    expect(result.items[0].parts[0].type).toBe("tool")
    expect((result.items[0].parts[0] as MessageV2.ToolPart).tool).toBe("bash")
  })

  test("blob_hash = '' on reasoning part preserves text", () => {
    const sid = SessionID.make("ses_edge_reason_empty00000")
    insertSession(sid)
    const mid = MessageID.make("msg_edge_reason_empty00000")
    insertMessage(mid, 0, "assistant", sid, NOW + 123000)
    insertPart(
      PartID.make("prt_edge_re_0_0"),
      mid,
      sid,
      { type: "reasoning", text: "thinking with empty hash", time: { start: 100 } },
      "",
    )

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(1)
    expect(result.items[0].parts[0].type).toBe("reasoning")
    expect((result.items[0].parts[0] as MessageV2.ReasoningPart).text).toBe("thinking with empty hash")
  })

  test("realistic old session: user msg + assistant msg with mixed parts, all blob_hash = ''", () => {
    const sid = SessionID.make("ses_edge_realistic00000000")
    insertSession(sid)

    // User message
    const umid = MessageID.make("msg_edge_real_0_user0000000")
    insertMessage(umid, 0, "user", sid, NOW + 130000)
    insertPart(PartID.make("prt_edge_real_0u_tx"), umid, sid, { type: "text", text: "Please fix the bug" }, "")

    const amid = MessageID.make("msg_edge_real_1_asst0000000")
    insertMessage(amid, 1, "assistant", sid, NOW + 131000)
    insertPart(PartID.make("prt_edge_real_1a_0s"), amid, sid, { type: "step-start" }, "")
    insertPart(
      PartID.make("prt_edge_real_1a_1t"),
      amid,
      sid,
      { type: "text", text: "I'll fix the bug by editing the file." },
      "",
    )
    insertPart(
      PartID.make("prt_edge_real_1a_2l"),
      amid,
      sid,
      {
        type: "tool",
        tool: "edit",
        callID: "call_real",
        state: {
          status: "completed",
          input: { file: "src/main.ts", old: "bug", new: "fix" },
          output: "Applied edit",
          title: "edit",
          metadata: {},
          time: { start: 100, end: 200 },
        },
      },
      "",
    )
    insertPart(
      PartID.make("prt_edge_real_1a_3t"),
      amid,
      sid,
      { type: "text", text: "The bug has been fixed." },
      "",
    )
    insertPart(
      PartID.make("prt_edge_real_1a_4f"),
      amid,
      sid,
      {
        type: "step-finish",
        reason: "end_turn",
        cost: 0.05,
        tokens: { input: 500, output: 200, reasoning: 0, cache: { read: 100, write: 50 } },
      },
      "",
    )

    const result = MessageV2.page({ sessionID: sid, limit: 10 })
    expect(result.items.length).toBe(2)

    const userMsg = result.items.find((m) => m.info.role === "user")!
    const assistantMsg = result.items.find((m) => m.info.role === "assistant")!
    expect(userMsg).toBeDefined()
    expect(assistantMsg).toBeDefined()

    expect(userMsg.parts.length).toBe(1)
    expect((userMsg.parts[0] as MessageV2.TextPart).text).toBe("Please fix the bug")

    expect(assistantMsg.parts.length).toBe(5)
    expect(assistantMsg.parts[0].type).toBe("step-start")
    expect((assistantMsg.parts[1] as MessageV2.TextPart).text).toBe("I'll fix the bug by editing the file.")
    expect(assistantMsg.parts[2].type).toBe("tool")
    expect((assistantMsg.parts[3] as MessageV2.TextPart).text).toBe("The bug has been fixed.")
    expect(assistantMsg.parts[4].type).toBe("step-finish")

    const serialized = JSON.stringify(result.items)
    const deserialized = JSON.parse(serialized) as MessageV2.WithParts[]
    const dUser = deserialized.find((m) => m.info.role === "user")!
    const dAsst = deserialized.find((m) => m.info.role === "assistant")!
    expect((dUser.parts[0] as MessageV2.TextPart).text).toBe("Please fix the bug")
    expect((dAsst.parts[1] as MessageV2.TextPart).text).toBe("I'll fix the bug by editing the file.")
    expect((dAsst.parts[3] as MessageV2.TextPart).text).toBe("The bug has been fixed.")
  })
})
