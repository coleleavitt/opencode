# Chunked Storage & Context Window Refactor

## TL;DR

> **Quick Summary**: Refactor opencode's message/part storage from "load everything" to tiered hot/warm/cold architecture with O(k) context assembly, CAS blob dedup, and FTS5 search — eliminating the 3-9GB RSS caused by `filterCompactedEffect` loading all messages.
> 
> **Deliverables**:
> - CAS blob store for large parts (>4KB)
> - O(k) context window assembly (only load what the LLM needs)
> - Compaction boundary-aware message loading
> - FTS5 search index for conversation history
> - TUI sync store eviction on session navigation
> - SQLite mmap + page size optimization
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 6 waves
> **Critical Path**: Task 1 → Task 3 → Task 7 → Task 10 → Task 13 → F1-F4

---

## Context

### Original Request
Implement block/chunk-based storage for opencode conversation parts to eliminate multi-GB RSS growth when loading large sessions (633+ messages, 2338+ parts, 70MB+ data).

### Interview Summary
**Key Discussions**:
- Current `filterCompactedEffect` loads ALL messages + ALL parts into memory for every LLM call
- Sessions with 1000+ messages cause 3-9GB RSS, triggering GC storms and TUI freezes
- Claude Code uses three-tier compaction with hot tail / cold storage split
- Research shows full-context loading is the worst baseline (Mem0: 26% worse accuracy, 90% more latency)

**Research Findings**:
- DABA sliding window: O(1) insert/evict/query for context windows
- SQLite incremental blob I/O: streaming reads for large parts
- CAS deduplication: 30-60% storage reduction for repeated tool outputs
- FTS5 content-table mode: search without loading all parts
- mmap: zero-copy reads for context assembly

### Metis Review
**Identified Gaps** (addressed):
- Migration strategy for existing 26GB database with 988K parts
- Backward compatibility with existing TUI sync store consumers
- Blob threshold selection (4KB chosen based on SQLite internal/external benchmark)
- FTS5 trigger overhead during streaming (batched via WAL)

---

## Work Objectives

### Core Objective
Replace the O(n) "load all messages" pattern with O(k) "load hot tail" pattern, backed by tiered storage with CAS deduplication.

### Concrete Deliverables
- New `blobs` table with SHA-256 content addressing
- Modified `parts` table with `blob_hash` column for large content
- `assembleContextWindow(sessionId, k)` function replacing `filterCompactedEffect`
- FTS5 index on parts for search
- TUI sync store bounded session cache
- SQLite pragma optimizations (mmap, page_size)
- Migration for existing data
- Regression tests for large sessions

### Definition of Done
- [ ] `bun test` passes with new storage layer
- [ ] RSS stays under 500MB for 1000+ message sessions
- [ ] Context assembly completes in <100ms for k=100
- [ ] FTS5 search returns results in <50ms
- [ ] Existing API surface unchanged (no breaking changes)

### Must Have
- O(k) context window assembly
- CAS blob deduplication for parts >4KB
- Compaction boundary-aware loading
- TUI sync store eviction
- Migration for existing data

### Must NOT Have (Guardrails)
- Do NOT replace SQLite with RocksDB/LMDB
- Do NOT change the message/part API types
- Do NOT break the TUI rendering
- Do NOT add external dependencies (no WASM, no native modules)
- Do NOT touch the LLM provider layer

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: YES (Tests-after)
- **Framework**: bun test

### QA Policy
Every task includes agent-executed QA scenarios.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — schema + migration):
├── Task 1: Add blobs table + blob_hash column migration [general]
├── Task 2: SQLite pragma optimizations (mmap, page_size) [general]
├── Task 3: CAS blob store module [general]
└── Task 4: Part size threshold constants + types [general]

Wave 2 (Storage layer — write path):
├── Task 5: Externalize large parts on write (depends: 1, 3, 4) [general]
├── Task 6: Blob dedup check on insert (depends: 3) [general]
└── Task 7: Streaming write batching for LLM responses (depends: 5) [general]

Wave 3 (Read path — context assembly):
├── Task 8: assembleContextWindow(sessionId, k) function (depends: 1, 3) [general]
├── Task 9: Compaction boundary-aware loading (depends: 8) [general]
├── Task 10: Replace filterCompactedEffect with hot-tail loader (depends: 9) [general]
└── Task 11: FTS5 index + search function (depends: 1) [general]

Wave 4 (TUI integration):
├── Task 12: Sync store bounded session cache (depends: 10) [general]
├── Task 13: Session data eviction on navigation (depends: 12) [general]
└── Task 14: Part lazy-loading in TUI message display (depends: 12) [general]

Wave 5 (Testing + migration):
├── Task 15: Migration script for existing 26GB database (depends: 1, 3) [general]
├── Task 16: Regression tests — large session scenarios (depends: 10) [general]
├── Task 17: Performance benchmark — RSS + latency (depends: 10, 12) [general]
└── Task 18: FTS5 sync triggers (depends: 11) [general]

Wave FINAL (Verification):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (general)
├── Task F3: Real manual QA (general)
└── Task F4: Scope fidelity check (general)
-> Present results -> Get explicit user okay
```

---

## TODOs

- [x] 1. Add `blobs` table + `blob_hash` column migration

  **What to do**:
  - Create Drizzle migration adding `blobs` table (hash TEXT PK, size INTEGER, data BLOB)
  - Add `blob_hash TEXT` column to existing `part` table
  - Add index on `parts(session_id, time_created, id)` if not exists
  - Run `bun run db generate --name chunked_storage`

  **Must NOT do**:
  - Do NOT modify existing part data in migration
  - Do NOT add foreign key constraint (blobs may be shared across sessions)

  **Recommended Agent Profile**:
  - **Category**: `general`
  - **Skills**: [`effect`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5, 6, 8, 11, 15
  - **Blocked By**: None

  **References**:
  - `src/storage/schema.sql.ts` — existing schema patterns
  - `src/session/session.sql.ts:1-30` — part table definition
  - `migration/` — existing migration format

  **Acceptance Criteria**:
  - [ ] Migration SQL generated in `migration/` directory
  - [ ] `bun run db generate` exits 0
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Migration applies cleanly
    Tool: Bash
    Steps:
      1. Run: bun run db generate --name chunked_storage
      2. Verify migration file exists
      3. Run opencode briefly to trigger migration
    Expected: No errors, blobs table exists
  ```

  **Commit**: YES
  - Message: `feat(storage): add blobs table and blob_hash column for CAS storage`

---

- [x] 2. SQLite pragma optimizations

  **What to do**:
  - Add `PRAGMA mmap_size = 134217728` (128MB) to db.ts
  - Add `PRAGMA page_size = 8192` (only effective on new databases)
  - Add `PRAGMA temp_store = MEMORY`

  **Recommended Agent Profile**:
  - **Category**: `general`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None (performance optimization)
  - **Blocked By**: None

  **References**:
  - `src/storage/db.ts:89-94` — existing pragma configuration

  **Acceptance Criteria**:
  - [ ] Pragmas added after existing ones
  - [ ] `bun typecheck` passes

  **Commit**: YES (groups with 1)

---

- [x] 3. CAS blob store module

  **What to do**:
  - Create `src/storage/cas.ts` with:
    - `hash(content: string | Buffer): string` — SHA-256 truncated to 32 hex chars
    - `store(content: string | Buffer): string` — returns hash, inserts if not exists
    - `retrieve(hash: string): Buffer | null` — fetches blob data
    - `exists(hash: string): boolean` — O(1) dedup check
  - Use Bun.CryptoHasher for SHA-256
  - Use `INSERT OR IGNORE INTO blobs` for idempotent writes

  **Recommended Agent Profile**:
  - **Category**: `general`
  - **Skills**: [`effect`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5, 6, 8
  - **Blocked By**: None (can use in-memory schema for development)

  **References**:
  - `src/storage/blob.ts` — existing blob externalization pattern (URL data >64KB)
  - `src/storage/storage.ts` — Database.use() pattern
  - Research: CAS section showing `INSERT OR IGNORE` pattern

  **Acceptance Criteria**:
  - [ ] `cas.store("hello")` returns consistent hash
  - [ ] `cas.store("hello")` called twice inserts only one row
  - [ ] `cas.retrieve(hash)` returns original content
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Deduplication works
    Tool: Bash (bun test)
    Steps:
      1. Store same content twice
      2. Verify blobs table has exactly 1 row
      3. Retrieve by hash, verify content matches
    Expected: Single blob row, content round-trips correctly
  ```

  **Commit**: YES
  - Message: `feat(storage): add content-addressed blob store module`

---

- [x] 4. Part size threshold constants + types

  **What to do**:
  - Add `BLOB_THRESHOLD = 4096` constant (4KB — below SQLite's 100KB inline/external crossover)
  - Add `isLargePart(content: string): boolean` helper
  - Update Part type to include optional `blob_hash` field

  **Recommended Agent Profile**:
  - **Category**: `general`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `src/session/message-v2.ts` — Part type definition
  - Research: SQLite internal vs external blob benchmark (100KB threshold)

  **Commit**: YES (groups with 3)

---

- [x] 5. Externalize large parts on write

  **What to do**:
  - In `MessageV2.updatePart()`, check `isLargePart(part.content)`
  - If large: `hash = cas.store(content)`, set `blob_hash = hash`, clear inline `content`
  - If small: store inline as before
  - Update `MessageV2.parts()` read path to resolve blob_hash → content

  **Recommended Agent Profile**:
  - **Category**: `general`
  - **Skills**: [`effect`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 1, 3, 4

  **References**:
  - `src/session/message-v2.ts:1089-1102` — parts() function
  - `src/session/index.ts` — updatePart path
  - `src/storage/blob.ts` — existing externalization pattern

  **Acceptance Criteria**:
  - [ ] Parts >4KB stored in blobs table
  - [ ] Parts <4KB stored inline
  - [ ] `parts()` transparently resolves both

  **Commit**: YES
  - Message: `feat(session): externalize large parts to CAS blob store`

---

- [x] 6. Blob dedup check on insert

  **What to do**:
  - In CAS store, use `INSERT OR IGNORE` (already in Task 3)
  - Add metrics: count dedup hits vs misses
  - Log dedup ratio periodically

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocked By**: Task 3

  **Commit**: YES (groups with 5)

---

- [x] 7. Streaming write batching for LLM responses

  **What to do**:
  - In session processor streaming path, accumulate tokens until chunk boundary
  - Batch INSERT parts per chunk (not per token)
  - Chunk boundary: tool_use complete, text block >1KB, or stream end

  **Recommended Agent Profile**:
  - **Category**: `general`
  - **Skills**: [`effect`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Task 5

  **References**:
  - `src/session/processor.ts:216-461` — streaming event handling
  - Research: "batch writes per chunk, not per token" pattern

  **Commit**: YES
  - Message: `perf(session): batch streaming part writes at chunk boundaries`

---

- [x] 8. assembleContextWindow function

  **What to do**:
  - Create `src/session/context-window-assembly.ts`
  - `assembleContextWindow(sessionId, k)` — loads last k messages with parts
  - Uses `SELECT ... ORDER BY time_created DESC LIMIT k` (O(k) query)
  - Resolves blob_hash → content for externalized parts
  - Returns `WithParts[]` in chronological order

  **Recommended Agent Profile**:
  - **Category**: `general`
  - **Skills**: [`effect`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: Tasks 1, 3

  **References**:
  - `src/session/message-v2.ts:1075-1087` — current stream() function (loads ALL)
  - `src/session/message-v2.ts:1038-1073` — page() function with LIMIT
  - Research: O(k) context assembly pattern
  - Claude Code: `getMessagesAfterCompactBoundary()` pattern

  **Acceptance Criteria**:
  - [ ] `assembleContextWindow(sid, 50)` loads exactly 50 messages
  - [ ] Large parts resolved from blob store transparently
  - [ ] Returns messages in chronological order (oldest first)
  - [ ] RSS stays bounded regardless of total session size

  **QA Scenarios**:
  ```
  Scenario: Only loads k messages from 1000+ session
    Tool: Bash (bun test)
    Steps:
      1. Create session with 1000 messages
      2. Call assembleContextWindow(sid, 50)
      3. Verify exactly 50 messages returned
      4. Verify RSS delta < 10MB
    Expected: 50 messages, bounded memory
  ```

  **Commit**: YES
  - Message: `feat(session): O(k) context window assembly function`

---

- [x] 9. Compaction boundary-aware loading

  **What to do**:
  - Modify `assembleContextWindow` to respect compaction markers
  - If a compaction part exists in the last k messages, only load messages after it
  - Preserve `filterCompacted` logic but apply it to the k-sized window, not all messages

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 10
  - **Blocked By**: Task 8

  **References**:
  - `src/session/message-v2.ts:1119-1144` — filterCompacted function
  - `src/session/compaction.ts` — compaction logic

  **Commit**: YES (groups with 8)

---

- [x] 10. Replace filterCompactedEffect with hot-tail loader

  **What to do**:
  - In `prompt.ts:1342`, replace `filterCompactedEffect(sessionID)` with `assembleContextWindow(sessionID, 100)`
  - Adjust k based on model context window (100 for 200K, 200 for 1M)
  - Keep `filterCompactedEffect` as fallback for small sessions

  **Recommended Agent Profile**:
  - **Category**: `general`
  - **Skills**: [`effect`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Tasks 12, 16, 17
  - **Blocked By**: Task 9

  **References**:
  - `src/session/prompt.ts:1342` — the bottleneck line
  - `src/session/context-window.ts` — token budget calculations
  - Claude Code `query.ts` — `getMessagesAfterCompactBoundary()` pattern

  **Acceptance Criteria**:
  - [ ] Prompt submission loads at most k messages
  - [ ] RSS stays under 500MB for 1000+ message sessions
  - [ ] LLM receives correct context (recent messages + compaction summary)

  **QA Scenarios**:
  ```
  Scenario: Large session prompt submission stays bounded
    Tool: Bash
    Steps:
      1. Open session with 633 messages (unlace regression)
      2. Submit a query
      3. Monitor RSS during prompt assembly
    Expected: RSS delta < 100MB, prompt assembled in <1s
  ```

  **Commit**: YES
  - Message: `fix(session): replace filterCompactedEffect with O(k) hot-tail loader`

---

- [x] 11. FTS5 index + search function

  **What to do**:
  - Add FTS5 virtual table in migration (content-table mode)
  - Add sync triggers (AFTER INSERT, AFTER UPDATE, AFTER DELETE on parts)
  - Create `searchParts(query, sessionId?, limit)` function
  - Use `bm25()` for ranking

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocked By**: Task 1

  **Commit**: YES
  - Message: `feat(storage): add FTS5 search index for conversation parts`

---

- [x] 12. Sync store bounded session cache

  **What to do**:
  - Add `MAX_CACHED_SESSIONS = 5` constant to sync.tsx
  - Track session access order (LRU)
  - When navigating to a new session, evict oldest cached session's messages/parts

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocked By**: Task 10

  **References**:
  - `src/cli/cmd/tui/context/sync.tsx:63-68` — message/part store
  - Research: LRU eviction pattern

  **Commit**: YES
  - Message: `perf(tui): add LRU session cache with bounded memory`

---

- [x] 13. Session data eviction on navigation

  **What to do**:
  - When route changes from session A to session B, drop A's messages/parts from store
  - Keep session metadata (title, timestamps) but drop heavy data
  - Re-sync from DB when navigating back

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocked By**: Task 12

  **Commit**: YES (groups with 12)

---

- [x] 14. Part lazy-loading in TUI message display

  **What to do**:
  - For messages with externalized parts (blob_hash), show placeholder until scrolled into view
  - Load blob content on demand via SDK call
  - Cache loaded blobs in sync store

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocked By**: Task 12

  **Commit**: YES
  - Message: `feat(tui): lazy-load externalized parts on scroll`

---

- [x] 15. Migration script for existing database

  **What to do**:
  - Background task that scans existing parts >4KB
  - Externalizes to blobs table with CAS dedup
  - Updates blob_hash, clears inline content
  - Progress reporting (% complete)
  - Idempotent (safe to re-run)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocked By**: Tasks 1, 3

  **Commit**: YES
  - Message: `feat(storage): migration script to externalize existing large parts`

---

- [x] 16. Regression tests — large session scenarios

  **What to do**:
  - Test with 633 messages (unlace regression)
  - Test with 1085 messages (Git workflow session)
  - Test context assembly time < 100ms
  - Test RSS bounded < 500MB
  - Test FTS5 search < 50ms

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocked By**: Task 10

  **Commit**: YES
  - Message: `test(session): add large session regression tests`

---

- [x] 17. Performance benchmark

  **What to do**:
  - Measure RSS before/after refactor for 633-message session
  - Measure context assembly latency
  - Measure FTS5 search latency
  - Measure CAS dedup ratio
  - Output as markdown report

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocked By**: Tasks 10, 12

  **Commit**: YES (groups with 16)

---

- [x] 18. FTS5 sync triggers

  **What to do**:
  - AFTER INSERT ON parts → INSERT INTO parts_fts
  - AFTER UPDATE ON parts → UPDATE parts_fts
  - AFTER DELETE ON parts → DELETE FROM parts_fts
  - Batched via WAL (triggers fire in same transaction)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocked By**: Task 11

  **Commit**: YES (groups with 11)

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
- [x] F2. **Code Quality Review** — `general`
- [x] F3. **Real Manual QA** — `general`
- [x] F4. **Scope Fidelity Check** — `general`

---

## Commit Strategy

- **Wave 1**: `feat(storage): add CAS blob store + schema migration + pragma optimizations`
- **Wave 2**: `feat(session): externalize large parts to CAS + streaming batch writes`
- **Wave 3**: `feat(session): O(k) context window assembly replacing filterCompactedEffect`
- **Wave 4**: `perf(tui): bounded session cache + lazy part loading + eviction`
- **Wave 5**: `test+perf: large session regression tests + migration + benchmarks`

---

## Success Criteria

### Verification Commands
```bash
bun typecheck                    # Expected: exit 0
bun test src/session/            # Expected: all pass
bun test src/storage/            # Expected: all pass
```

### Final Checklist
- [ ] RSS < 500MB for 1000+ message sessions
- [ ] Context assembly < 100ms for k=100
- [ ] FTS5 search < 50ms
- [ ] CAS dedup ratio > 30%
- [ ] All existing tests pass
- [ ] No breaking API changes
- [ ] Migration handles 26GB database
