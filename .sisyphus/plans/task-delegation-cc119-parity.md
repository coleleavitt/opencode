# Task Delegation cc119 Parity Refactor

**Status**: DRAFT — pending user approval
**Owner**: TBD
**Branch**: `fix/memory-20695` (current)
**Repos**:
- opencode: `/home/cole/WebstormProjects/forks/opencode`
- oh-my-opencode: `/home/cole/WebstormProjects/forks/oh-my-opencode`
**Reference**: `~/VulnerabilityResearch/anthropic/versions/cli.2.1.119.aligned.js` (cc119 ground truth)

---

## 1. Goal

Bring opencode's Task tool and oh-my-opencode's delegate-task wrapper to functional parity with Claude Code v2.1.119's native delegation system, while removing dead/duplicated code introduced by OMO bolting features onto opencode externally.

**Success criteria**:
1. Every cc119 Task schema field has a working opencode counterpart (or a documented intentional omission)
2. OMO's 2349-line BackgroundManager is either deleted or shrunk to a thin shim over opencode's native primitives
3. The `output-style-setup` and `code-reviewer` agent advertisements are either backed by real definitions or removed
4. All existing tests continue to pass; new tests cover every added field
5. `bun typecheck` clean across all touched packages
6. No regression in the OMO category-dispatch UX (LLM-facing schema may shift, but behavior is preserved)

---

## 2. Scope

### In scope (Phase B — opencode native parity)
- B1. `model` per-call override on Task schema
- B2. `isolation: "worktree"` Task param + integration with existing Worktree service
- B3. Native `run_in_background` on opencode Task tool
- B4. Fork mode: implicit subagent that inherits parent context (cc119 line 173738 `GI`)
- B5. `name` + `team_name` schema fields for teammate addressing (cc119 lines 309289–309291)
- B6. Tool dual-name registration: register Task as both `"task"` and `"agent"` alias
- B7. Honor `omitClaudeMd` flag on agent definitions (currently unused in opencode)
- B8. Partial-output preservation in `handleSubtask` (cc119 line 309806 behavior)

### In scope (Phase C — OMO reconciliation)
- C1. Re-implement OMO category dispatch on top of new opencode `model` override (decouple from `sisyphus-junior`)
- C2. Audit `output-style-setup` and `code-reviewer` agent advertisements; remove or back with real definitions
- C3. Shrink/delete OMO BackgroundManager once opencode native equivalent exists
- C4. Migrate OMO teammate registry to opencode's new `name` + `team_name` primitives (or document why we keep custom)

### In scope (Phase D — optional polish)
- D1. Brand-aware memory loader: read `CLAUDE.md` alongside `AGENTS.md`
- D2. Schema field annotations for OpenAPI/SDK consumers

### Out of scope
- Memory system rewrite (OMO's `memory_save`/`memory_list` is fine as-is)
- Hook system overhaul (separate domain)
- Skill loader rewrite
- Output styles file-based resource system (separate from delegation)
- Anything in `packages/sdk/`, `packages/console/`, or other non-core packages
- DB schema changes requiring migrations
- Effect runtime architecture changes

---

## 3. Constraints

- **Modular code rule** (`.sisyphus/rules/modular-code-enforcement.md`): 200 LOC hard limit per file; one responsibility per file; no `utils.ts`/`service.ts` catch-alls
- **Effect patterns** (`packages/opencode/AGENTS.md`): `Effect.gen` + `Effect.fn`, `Schema.TaggedErrorClass` for typed errors, `yield* new MyError(...)` over `Effect.fail(new MyError(...))`, `Effect.forkIn(scope)` instead of `Effect.fork`/`Effect.forkDaemon`, `InstanceState` for per-directory state
- **No `as any` / `@ts-ignore` / `@ts-expect-error`**
- **Tests run from package directories** (`packages/opencode`, never repo root)
- **No DB migrations unless explicitly approved** — preserves backward compat with existing session JSONL transcripts
- **No commits without user approval**

---

## 4. Risks

| Risk                                                                              | Likelihood | Impact     | Mitigation                                                                                                  |
| --------------------------------------------------------------------------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| Deprecating OMO BackgroundManager breaks OMO consumers                            | High       | High       | Land opencode native bg first, keep OMO BG as adapter, deprecate over 2 releases                            |
| `isolation: "worktree"` introduces git-state corruption                           | Medium     | High       | Reuse existing `Worktree` service; never auto-merge; surface branch+path on dirty exit                      |
| Adding `model` param breaks tool-call schema validation for older persisted calls | Medium     | Medium     | Make `model` optional; default to current behavior (agent's hardcoded model)                                |
| Fork mode changes context-window math                                             | Medium     | Medium     | Reuse parent's `forkContextMessages` slice with explicit token budget check                                 |
| Teammate `name`+`team_name` collides with OMO's in-memory registry semantics      | Medium     | Low        | Spec resolution order: opencode native first, OMO registry as fallback, dismissal cascades                  |
| Partial-output preservation masks real bugs                                       | Low        | Medium     | Gate behind config flag; default off; opt-in for "best effort" semantics                                    |
| 200 LOC limit forces excessive file fragmentation                                 | Medium     | Low        | Group related schemas/errors per cc119 surface area                                                         |
| OMO `output-style-setup` agent has downstream consumers                           | Low        | Low        | Grep first; if no consumers, delete; otherwise alias to no-op with warning                                  |
| Test infrastructure mocks model dispatch — real-model integration tests skipped   | Medium     | Low        | Keep behavior tests at unit level; document that integration verification needs `provideTmpdirServer(...)`  |

---

## 5. Test Strategy

**Default**: TDD for additive features (write test → fail → implement → pass), tests-after for refactors that preserve behavior.

| Task class                | Strategy                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| New schema field          | TDD: add Zod test, then accept-and-route test                                                                       |
| New error class           | TDD: assert `Schema.TaggedErrorClass` shape, message format                                                         |
| Fork mode                 | TDD: parent message history flows into subagent's context, token budget honored                                     |
| Background tasks          | TDD: launch returns task_id, completion notification, cancellation, error propagation                               |
| Worktree isolation        | TDD: clean exit removes worktree; dirty exit surfaces branch+path; non-git project errors clearly                   |
| OMO category reconcile    | Tests-after: existing OMO behavior must still work end-to-end; add tests for new category-via-model path            |
| BackgroundManager removal | Tests-after: OMO consumer tests still pass with adapter shim                                                        |

**Test runners**:
- opencode: `cd packages/opencode && bun test test/<area>/`
- OMO: `cd /home/cole/WebstormProjects/forks/oh-my-opencode && bun test src/<area>/` (verify with user before adding new test files)

**Pre-flight**:
- `bun typecheck` from each package directory before merging any task
- `lsp_diagnostics` clean on every changed file
- `bun test test/tool/` green before moving to next task

---

## 6. Tasks

### Phase B — opencode native parity

#### B1. `model` per-call override on Task schema

**Goal**: Allow `task(subagent_type="explore", model={modelID,providerID})` to override the agent's hardcoded model for a single dispatch (cc119 has `model: "sonnet"|"opus"|"haiku"` — opencode's broader provider/model space needs the full struct).

**Acceptance**:
- Schema accepts optional `model: { modelID: string, providerID: string }`
- When omitted, falls back to agent's hardcoded model OR parent's model (current behavior preserved)
- When provided, the spawned session uses the override
- Test: model override flows into `ops.prompt({ model })`
- Test: unknown providerID/modelID surfaces a typed `ModelNotFoundError`

**Files**:
- MODIFY `packages/opencode/src/tool/task.ts` — add `model` field to Zod schema (~5 LOC), add resolution logic (~10 LOC), keep file under 200 LOC
- MODIFY `packages/opencode/src/tool/task-errors.ts` — add `ModelNotFoundError` (~10 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 2 tests (~80 LOC)

**Effort**: Small (~2 hours)

---

#### B2. `isolation: "worktree"` Task param

**Goal**: Allow `task(isolation: "worktree", ...)` to spawn the subagent inside a throwaway git worktree, isolated from the parent's working tree.

**Acceptance**:
- Schema accepts optional `isolation: z.enum(["worktree"])`
- When set, calls `Worktree.create()` before spawning the subagent session
- Subagent's `cwd` = worktree path
- On clean completion (no commits, no dirty tree), worktree is auto-removed
- On dirty completion (commits OR untracked files), result includes `worktreeBranch` and `worktreePath` for user review; worktree is NOT auto-removed
- Non-git project: typed `WorktreeIsolationUnavailableError` with message explaining
- Test: clean run → worktree gone after
- Test: dirty run → worktree preserved, metadata includes branch+path
- Test: non-git project → typed error

**Files**:
- MODIFY `packages/opencode/src/tool/task.ts` — schema field + worktree wiring (~25 LOC)
- MODIFY `packages/opencode/src/tool/task-errors.ts` — add `WorktreeIsolationUnavailableError` (~12 LOC)
- NEW `packages/opencode/src/tool/task-worktree.ts` — extracted worktree-isolation logic if task.ts exceeds 200 LOC (~80 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 3 tests (~150 LOC)

**Dependencies**: Worktree service at `packages/opencode/src/worktree/index.ts` (existing)

**Effort**: Medium (~6 hours)

---

#### B3. Native `run_in_background` on opencode Task tool

**Goal**: Add cc119-equivalent `run_in_background` that returns a task_id immediately and the parent receives a `<task-notification>` when complete.

**Acceptance**:
- Schema accepts optional `run_in_background: z.boolean()`
- When `true`: `ops.prompt()` is called via `Effect.forkIn(scope)`; task tool returns `{ status: "async_launched", task_id, output_file }` immediately
- Background task progress flows to parent via Bus events (`Session.Event.BackgroundProgress`)
- Completion injects a `<task-notification>` part on the parent's next assistant message
- `background_output(task_id)` returns the accumulated subagent messages
- `background_cancel(task_id)` aborts the fork
- Conditional schema: respect `OPENCODE_DISABLE_BACKGROUND_TASKS` env var (mirrors cc119's `MFH` flag)
- Test: launch → status_async_launched + task_id minted
- Test: poll via background_output before completion → returns partial messages
- Test: cancel mid-flight → fork aborts, task marked cancelled
- Test: completion → notification injected on parent

**Files**:
- MODIFY `packages/opencode/src/tool/task.ts` — schema field + dispatch branch (~20 LOC)
- NEW `packages/opencode/src/tool/task-background.ts` — fork management, task_id minting (~150 LOC)
- NEW `packages/opencode/src/tool/task-background-registry.ts` — `InstanceState` cache of running fibers keyed by task_id (~80 LOC)
- NEW `packages/opencode/src/tool/background-output.ts` — `background_output` tool definition (~80 LOC)
- NEW `packages/opencode/src/tool/background-cancel.ts` — `background_cancel` tool definition (~50 LOC)
- MODIFY `packages/opencode/src/session/message-v2.ts` — add `BackgroundTaskNotificationPart` schema variant (~30 LOC) — REQUIRES migration if persisted? Verify with user before changing
- MODIFY `packages/opencode/src/bus/bus-event.ts` — add `Session.Event.BackgroundProgress` (~10 LOC)
- MODIFY `packages/opencode/src/tool/registry.ts` — register new tools in builtin list (~5 LOC)
- NEW `packages/opencode/test/tool/task-background.test.ts` — 5 tests (~250 LOC)

**Effort**: Large (~2 days)

**⚠️ Open question**: does `BackgroundTaskNotificationPart` schema change require a Drizzle migration? If yes, this task expands.

---

#### B4. Fork mode (implicit context inheritance)

**Goal**: Allow `task(prompt=..., description=...)` (omit `subagent_type`) to spawn an implicit fork that inherits the parent's full message history (cc119 `GI` agent at line 173738).

**Acceptance**:
- Schema makes `subagent_type` optional (currently required)
- When `subagent_type` is omitted, spawn a fork that inherits parent's `messages[]`
- Fork uses parent's exact tool whitelist (not a subset)
- Fork shares the parent's permission context
- Feature-flag gated: `cfg.experimental?.task_fork === true` (mirror cc119's `Ny()` check)
- Without the flag, omitting `subagent_type` falls back to current required behavior (Zod rejects)
- Test: with flag, fork inherits full history
- Test: with flag, fork has parent's tool set
- Test: without flag, omitting subagent_type errors

**Files**:
- MODIFY `packages/opencode/src/tool/task.ts` — fork dispatch branch (~15 LOC)
- MODIFY `packages/opencode/src/config/config.ts` — add `experimental.task_fork: boolean` (~3 LOC)
- MODIFY `packages/opencode/src/agent/agent.ts` — register `fork` builtin agent definition with `forksParentContext: true` flag (~30 LOC)
- MODIFY `packages/opencode/src/session/prompt.ts` — extend `PromptInput` with `forkContextMessages?` (~10 LOC), prepend in `runLoop` if set (~15 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 3 tests (~150 LOC)

**Effort**: Medium (~1 day)

**⚠️ Open question**: how does fork mode interact with `task_id` resume? cc119 has them as orthogonal; opencode's `task_id` is a session ID. Decision needed: forking with `task_id` set = invalid combination, error?

---

#### B5. `name` + `team_name` for teammate addressing

**Goal**: Native cc119-style addressable subagents that can be re-messaged across turns via `SendMessage`.

**Acceptance**:
- Schema accepts optional `name: z.string()` and `team_name: z.string()`
- When `name` is set, the spawned subagent is registered in a `TeammateRegistry` keyed by `(parentSessionID, name)`
- New `send_message` tool: `send_message({ to: name, message: string })` → posts a new user message to the named teammate's session
- New `dismiss_teammate` tool: `dismiss_teammate({ name })` → aborts the teammate's session and removes from registry
- Default capacity per parent session: 5 (configurable via `cfg.task.max_teammates`)
- Reusing a name rebinds (no slot consumed)
- `team_name` allows cross-session teammate sharing (lower priority — implement in second pass)
- Test: register → send_message → response captured
- Test: dismiss → fiber aborted, registry cleaned
- Test: capacity exceeded → typed `TeammateCapacityExceededError`
- Test: rebinding (same name twice) → does not consume new slot

**Files**:
- MODIFY `packages/opencode/src/tool/task.ts` — schema fields + registry registration (~20 LOC)
- NEW `packages/opencode/src/teammate/registry.ts` — `InstanceState`-backed teammate registry (~120 LOC)
- NEW `packages/opencode/src/teammate/errors.ts` — typed errors (~30 LOC)
- NEW `packages/opencode/src/tool/send-message.ts` — `send_message` tool (~80 LOC)
- NEW `packages/opencode/src/tool/dismiss-teammate.ts` — `dismiss_teammate` tool (~50 LOC)
- MODIFY `packages/opencode/src/tool/registry.ts` — register new tools (~5 LOC)
- NEW `packages/opencode/test/teammate/registry.test.ts` — 5 tests (~200 LOC)
- NEW `packages/opencode/test/tool/send-message.test.ts` — 3 tests (~150 LOC)

**Effort**: Large (~2 days)

**Dependencies**: B3 background tasks (teammates are inherently long-lived async tasks)

---

#### B6. Tool dual-name registration

**Goal**: Register the Task tool under both `"task"` and `"agent"` (cc119 uses `"Agent"` primary + `"Task"` alias). Prevents downstream confusion when porting cc119 prompts.

**Acceptance**:
- `agent` tool name resolves to the same definition as `task`
- Both names appear in registry listings
- Tool description identifies as the same tool with two names
- Test: invoke via `agent` → same behavior as `task`
- Test: registry lists both

**Files**:
- MODIFY `packages/opencode/src/tool/registry.ts` — add alias registration (~15 LOC)
- MODIFY `packages/opencode/src/tool/task.ts` — export the tool with alias metadata (~3 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 1 test (~30 LOC)

**Effort**: Small (~1 hour)

---

#### B7. Honor `omitClaudeMd` flag on agent definitions

**Goal**: cc119's Plan agent has `omitClaudeMd: true` (line 204215) — does NOT receive CLAUDE.md content. opencode reads `AGENTS.md` for every agent regardless. Add the flag and honor it.

**Acceptance**:
- `Agent.Info` schema accepts optional `omitProjectContext: boolean`
- When `true`, the agent's system prompt does NOT include AGENTS.md content
- opencode's built-in `plan` agent gets `omitProjectContext: true` (mirrors cc119)
- Config-defined agents can opt in via YAML/MD frontmatter
- Test: agent with flag → AGENTS.md NOT in system prompt
- Test: agent without flag → AGENTS.md present (current behavior)

**Files**:
- MODIFY `packages/opencode/src/agent/agent.ts` — add `omitProjectContext` to `Info` schema, set on `plan` builtin (~10 LOC)
- MODIFY `packages/opencode/src/config/agent.ts` — accept `omit_project_context` in YAML frontmatter (~5 LOC)
- MODIFY `packages/opencode/src/session/system.ts` — skip AGENTS.md injection when flag set (~10 LOC)
- MODIFY `packages/opencode/test/agent/agent.test.ts` — add 2 tests (~80 LOC)

**Effort**: Small (~3 hours)

---

#### B8. Partial-output preservation in `handleSubtask`

**Goal**: When a subagent fails mid-stream but produced ≥1 assistant message, return the partial output as the tool result with a recovery suffix (mirrors cc119 line 309806).

**Acceptance**:
- New behavior gated behind `cfg.task?.preserve_partial_output: boolean` (default `false` — preserves current strict behavior)
- When `true` and `result === undefined` AND subagent's session has assistant messages: fetch the last assistant message text and return it as the tool result with suffix `(recovered from error: <message>)`
- When `false`: current behavior (error part)
- Test: subagent throws after producing text → recovered output returned
- Test: subagent throws before any output → still errors (no recovery possible)
- Test: flag off → current behavior

**Files**:
- MODIFY `packages/opencode/src/session/prompt.ts` — modify `handleSubtask` `if (!result)` branch to check for recoverable assistant messages (~25 LOC)
- MODIFY `packages/opencode/src/config/config.ts` — add `task.preserve_partial_output: boolean` (~3 LOC)
- NEW `packages/opencode/src/session/handle-subtask-recovery.ts` — extracted recovery logic if `prompt.ts` adds 25+ LOC (~60 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 3 tests (~150 LOC)

**Effort**: Medium (~4 hours)

**⚠️ Open question**: Should the recovery be opt-in via flag (safer) or default-on (matches cc119)? Recommend opt-in for first release.

---

### Phase C — OMO reconciliation

#### C1. Re-implement OMO category dispatch on top of opencode `model` override

**Goal**: OMO currently coerces `category → subagent_type=sisyphus-junior` because that was the only way to inject a model override. With B1 done, OMO can pass `category → model={...}` and let `subagent_type` pass through unchanged.

**Acceptance**:
- OMO's `tools.ts:121-129` no longer force-sets `subagent_type = SISYPHUS_JUNIOR_AGENT`
- Instead: resolve `category` → `model` config, pass `model` to opencode's task tool, let `subagent_type` pass through (LLM picks the agent)
- BACKWARD COMPAT: if `subagent_type` not provided AND category provided, fall back to current sisyphus-junior coercion (preserves old behavior for callers that haven't migrated)
- New test: `task(category="ultrabrain", subagent_type="explore")` → explore agent runs on ultrabrain's model
- Existing OMO tests continue to pass

**Files**:
- MODIFY `oh-my-opencode/src/tools/delegate-task/tools.ts` — change category resolution (~30 LOC)
- MODIFY `oh-my-opencode/src/tools/delegate-task/category-resolver.ts` — return `model` instead of forcing agent (~20 LOC)
- NEW tests in OMO (file path TBD pending OMO test conventions)

**Effort**: Medium (~6 hours)

**Dependencies**: B1 (opencode `model` override must exist first)

**⚠️ Open question**: are there other places in OMO that assume `category → sisyphus-junior`? Audit needed before changing.

---

#### C2. Audit `output-style-setup` and `code-reviewer` agent advertisements

**Goal**: cc119 has neither as a built-in subagent. OMO advertises both. Either back them with real agent definitions or remove the advertisements.

**Acceptance**:
- `output-style-setup`: confirmed cc119 has none. OMO either:
  - (a) Removes the advertisement from agent listings, OR
  - (b) Adds a real OMO-specific agent definition that handles output styles
- `code-reviewer`: alias of `argus` (already real in OMO). Either:
  - (a) Document the alias, OR
  - (b) Remove duplicate listing and only advertise `argus`
- Test: invoking removed agent name → typed `UnknownAgentError` with suggestion
- Test: invoking remaining agent → works

**Files**:
- MODIFY `oh-my-opencode/src/agents/builtin-agents.ts` — remove or back agents (~20 LOC)
- MODIFY OMO agent listing in system prompts (~10 LOC across multiple files)
- Tests TBD

**Effort**: Small (~2 hours)

---

#### C3. Shrink/delete OMO BackgroundManager

**Goal**: Once B3 (opencode native background) lands, OMO's 2349-line BackgroundManager becomes redundant. Replace with a thin adapter.

**Acceptance**:
- OMO's `BackgroundManager.launch()` calls opencode's native `task(run_in_background: true)`
- Notification injection: replaced by opencode's native `<task-notification>` mechanism
- Concurrency manager: kept (still useful for OMO-specific concurrency policies)
- Old BackgroundManager file: shrunk to <200 LOC OR replaced entirely
- All OMO consumer tests still pass

**Files**:
- MODIFY `oh-my-opencode/src/features/background-agent/manager.ts` — gut and replace (~100 LOC final)
- MODIFY `oh-my-opencode/src/features/background-agent/spawner.ts` — delegate to opencode native (~50 LOC)
- DELETE: `oh-my-opencode/src/hooks/background-notification/` (replaced by native)
- Tests: regression suite must pass

**Effort**: Large (~3 days)

**Dependencies**: B3 (opencode native background)

**⚠️ Open question**: BackgroundManager has 2349 LOC for a reason — what features beyond launch/notify is it doing? Audit needed before deletion estimate is final.

---

#### C4. Migrate OMO teammate registry to opencode's `name`+`team_name` primitives

**Goal**: Once B5 lands, OMO's in-memory teammate registry is redundant.

**Acceptance**:
- OMO's `createTeammateRegistry()` becomes a thin facade over opencode's TeammateRegistry
- OMO's `send_message_to_teammate` becomes alias for opencode's `send_message`
- OMO's `dismiss_teammate` becomes alias for opencode's `dismiss_teammate`
- OMO's `list_teammates` reads from opencode's registry
- Existing OMO consumer tests pass

**Files**:
- MODIFY `oh-my-opencode/src/features/teammates/registry.ts` — facade (~50 LOC)
- MODIFY OMO's teammate tool definitions to be aliases (~30 LOC)

**Effort**: Medium (~1 day)

**Dependencies**: B5 (opencode native teammates)

---

### Phase D — optional polish

#### D1. Brand-aware memory loader

**Goal**: opencode reads `AGENTS.md`, cc119 reads `CLAUDE.md`. Some projects have only one. Read both.

**Acceptance**:
- Loader reads `AGENTS.md` first, then `CLAUDE.md` if present
- Both contents merged into agent system prompt
- Hierarchical walk preserved (cwd → root)
- `cfg.context.disable_claude_md: boolean` to opt out
- Test: project with only CLAUDE.md → content loaded
- Test: project with both → both loaded, AGENTS.md first
- Test: opt-out flag → CLAUDE.md skipped

**Files**:
- MODIFY `packages/opencode/src/session/system.ts` — extend instruction file loader (~30 LOC)
- MODIFY `packages/opencode/src/config/config.ts` — add config flag (~3 LOC)
- MODIFY `packages/opencode/test/session/system.test.ts` — add 3 tests (~120 LOC)

**Effort**: Small (~3 hours)

---

#### D2. Schema field annotations for OpenAPI/SDK

**Goal**: All new schema fields get proper `.meta()` / `.describe()` annotations so the generated SDK includes them.

**Acceptance**:
- `bun run script/build.ts` (SDK build) includes all new fields
- Each field has a clear description
- Optional fields are properly marked optional in OpenAPI

**Files**: All files modified in B1–B8 (annotation pass)

**Effort**: Small (~2 hours)

---

## 7. Execution Order

```
Phase B (opencode core, mostly parallelizable):
  B1 (model override)         ──┐
  B6 (dual-name)               ──┤── can run in any order
  B7 (omitClaudeMd)            ──┤
  B2 (worktree isolation)      ──┘
  B4 (fork mode)               ──── needs B1
  B3 (background)              ──── needs B1
  B5 (teammates)               ──── needs B3
  B8 (partial output)          ──── independent

Phase C (OMO, depends on Phase B):
  C2 (agent audit)             ──── independent, do early
  C1 (category reconcile)      ──── needs B1
  C3 (BackgroundManager)       ──── needs B3
  C4 (teammate migration)      ──── needs B5

Phase D (polish):
  D1 (CLAUDE.md)               ──── independent
  D2 (annotations)             ──── after each Phase B task lands
```

## 8. Verification at Phase Boundaries

**End of Phase B**:
- `bun typecheck` clean across all opencode packages
- `bun test test/` from `packages/opencode` — full green
- All new schema fields present in generated SDK
- Manual smoke: `task(model={...})`, `task(isolation: "worktree")`, `task(run_in_background: true)`, fork mode, teammate addressing

**End of Phase C**:
- OMO test suite passes
- Manual smoke: OMO category dispatch still works end-to-end
- BackgroundManager LOC reduced by ≥80%

**End of Phase D**:
- CLAUDE.md test passes
- SDK build clean

---

## 9. Out-of-Plan Discoveries

(To be filled in during execution. Anything that surfaces but is genuinely out of scope goes here for follow-up.)

---

## 10. Open Decisions Pending User Input

1. **B3 schema change**: Does adding `BackgroundTaskNotificationPart` to `MessageV2` parts require a Drizzle migration? If yes, scope expands.
2. **B4 fork+task_id combo**: Decide what `task(fork, task_id=...)` should do — error or fork from existing session?
3. **B8 partial output default**: opt-in flag (recommended) vs default-on (cc119 parity)?
4. **C3 BackgroundManager full audit**: 2349 LOC is suspiciously large for "launch + notify". Audit before committing to "shrink to 100 LOC".
5. **Teammate semantics divergence**: cc119's `team_name` is for cross-session sharing — opencode session model differs. Acceptable to ship `name`-only first?
6. **OMO test conventions**: where do new OMO tests live? Confirm directory + framework before adding.
7. **Sisyphus-Junior fate**: post-C1, is there still a reason to keep `sisyphus-junior` as a named agent? Or does it get deprecated?
8. **High-accuracy plan review**: Submit this plan to Momus for clarity/verifiability/completeness audit before execution?

---

## 11. Estimated Total Effort

| Phase | Tasks | Effort                |
| ----- | ----- | --------------------- |
| B     | 8     | ~10 days              |
| C     | 4     | ~5 days               |
| D     | 2     | ~5 hours              |
| **Total** | **14**  | **~3 weeks calendar** |

(Solo developer estimate. Parallelizable across 2 devs to ~1.5 weeks with B+C task split.)
