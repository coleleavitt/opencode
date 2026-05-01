# Learnings — Chunked Storage Refactor

## 2026-05-01 Task: Plan Analysis
- 22 total tasks: 18 implementation + 4 final verification
- 6 waves: Foundation → Storage Write → Read Path → TUI → Testing → Final
- Critical path: 1 → 3 → 5 → 7 → 8 → 9 → 10 → 12 → 16/17
- Wave 1 (Tasks 1-4) all independent, can run in parallel
- Effect framework used throughout codebase
- Tests run from packages/opencode, NOT repo root
- Drizzle ORM for schema, snake_case field names
- Bun APIs preferred (Bun.file, Bun.CryptoHasher)

## 2026-05-01 Task 4: Dedup Metrics
- `Cas.exists()` is O(1) via PK index — safe to call before every insert
- Checking exists() before insert avoids INSERT overhead for duplicates
- Module-level `let` counters are fine for non-Effect synchronous code
- `metrics()` exported for external consumers; periodic log every 100 stores
- `store()` signature/return unchanged — only internal flow modified
- `bun typecheck` runs `tsgo --noEmit` under the hood

## 2026-05-01 Task 7: Batch Part Writes Optimization
- `isLargePart()` creates `new Blob([content])` on every call — allocation overhead
- Pre-check `text.length > 1024` avoids Blob allocation for strings that can't exceed 4096 bytes
- Math: UTF-8 uses at most 4 bytes per char, so 1024 chars × 4 = 4096 bytes (the threshold)
- `Cas.store()` already has internal dedup via `exists()` check (Task 6), so no need to add hash pre-check
- Parts without a `text` field or with short text skip CAS entirely — no Blob, no hash, no DB lookup
- The projector runs synchronously; avoiding unnecessary allocations reduces GC pressure during streaming

## 2026-05-01 Task 13: TUI Lazy Part Loading Hook
- SDK `Part` type: `text` field is `string` (not optional) on TextPart/ReasoningPart — empty string `""` when externalized
- No `blob_hash` field exposed in SDK types — blob resolution is server-side only
- TUI hooks directory didn't exist; created `src/cli/cmd/tui/hooks/`
- `needsLazyLoad()` checks `"text" in part` then `part.text` truthiness — empty string is falsy
- Module follows flat exports + self-reexport pattern (`export * as UseLazyPart from "./use-lazy-part"`)
