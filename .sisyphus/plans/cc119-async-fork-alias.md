# cc119 Parity: Background Tasks, Fork Mode, Agent Alias

**Status**: DRAFT — pending user approval
**Owner**: TBD
**Branch**: `fix/memory-20695` (current)
**Repo**: `/home/cole/WebstormProjects/forks/opencode`
**Reference**: `~/VulnerabilityResearch/anthropic/versions/cli.2.1.119.aligned.js` (cc119 ground truth)
**Parent plan**: `.sisyphus/plans/task-delegation-cc119-parity.md` (these are the deferred B3, B4, B6 items)
**Already shipped on this branch**: B1 (model override), B7 (omit_project_context), log fixes, prompt_async error surfacing, db.test channel fix

---

## 1. Goal

Land the three deferred cc119 parity features cleanly:

- **B6 (smallest)**: Register Task tool under cc119-style `agent` name as a true alias (not duplicate); requires normalizing tool-name checks across TUI/CLI/permission/prompt layers.
- **B4 (medium)**: Make `subagent_type` optional and add cc119-style fork mode — implicit subagent spawn that inherits parent's full conversation context.
- **B3 (large)**: Native `run_in_background` on the Task tool — task-id minted, parent receives `<task-notification>` on completion, plus `task_status`/`task_cancel` companion tools.

**Success criteria** (post-merge):
1. LLM can invoke `agent(...)` and `task(...)` interchangeably with identical semantics
2. LLM can invoke `task(prompt=..., description=...)` (no `subagent_type`) and get a fork that inherits the parent's full message history
3. LLM can invoke `task(..., run_in_background: true)` and immediately receive a `task_id` while the work continues in a background fiber; on completion the parent's next assistant turn includes a `<task-notification>` part
4. `task_status(task_id)` returns the running/completed/failed state plus accumulated output
5. `task_cancel(task_id)` aborts the fork with status="killed"
6. Every existing test continues to pass; new tests cover every added surface
7. `bun typecheck` introduces zero new errors vs. the branch baseline (currently 2 pre-existing errors in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` unrelated to this work — confirmed via `git stash -u && bun typecheck`)

---

## 2. Scope

### IN
- Tool-name aliasing infrastructure (Tool.Def.aliases) + downstream normalization
- Optional `subagent_type` schema change
- Fork agent definition + context-inheritance plumbing
- Background task registry (in-memory, per-Instance)
- Background-task fiber lifecycle (`Effect.forkIn(scope)` + AbortController bridge)
- Completion notification injection mechanism (new `MessageV2.Part` variant)
- New tools: `task_status`, `task_cancel`
- Schema additions to existing Task tool: `run_in_background`, `name`, `team_name` (placeholder for future), `isolation` (placeholder for future)
- Tests covering every new surface + regression coverage

### OUT
- Teammate registry implementation (B5 — separate plan)
- Worktree-based isolation (B2 — separate plan)
- OMO-side reconciliation (Phase C in parent plan)
- DB schema migrations (we use in-memory registry; `MessageV2.Part` add is a JSON shape change, not DDL)
- Output-file mechanism (cc119 writes bg output to disk; opencode keeps it in the registry)
- Cross-process bg task survival (CLI restart kills bg tasks; documented as known limitation)
- Persistence of completed background results beyond the parent session lifetime

---

## 3. Constraints

- **Effect patterns** (`packages/opencode/AGENTS.md`): `Effect.gen` + `Effect.fn`, `Schema.TaggedErrorClass` for errors, `yield* new MyError(...)` over `Effect.fail(new MyError(...))`, `Effect.forkIn(scope)` (NOT `Effect.fork`/`forkDaemon`), `InstanceState` for per-directory state
- **Module shape** (`packages/opencode/AGENTS.md`): no `export namespace Foo`; flat top-level exports + `export * as Foo from "./foo"` self-reexport at file bottom
- **Single-responsibility per file**: keep new modules focused; extract a sibling file when a task pushes an existing file past ~200 LOC of non-prompt code
- **No catch-all filenames**: forbid `utils.ts` / `service.ts` / `helpers.ts` / `common.ts` as new top-level files; name files after their purpose
- **No `as any` / `@ts-ignore` / `@ts-expect-error`**
- **Tests run from `packages/opencode/`** (never repo root — `packages/opencode/test/AGENTS.md` rule)
- **No DB migrations** — `MessageV2.Part` JSON shape can absorb new variants without DDL
- **No commits without user approval**
- **Backward compat**: `subagent_type` already-required-shaped tool calls must continue to work; `run_in_background` must be opt-in
- **No regression** to existing test suite (latest baseline: 2153 pass)

---

## 4. Risk Register

| ID | Risk                                                                                    | Likelihood | Impact   | Mitigation                                                                                                       |
| -- | --------------------------------------------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| R1 | Renaming `tool === "task"` checks across TUI/CLI breaks visual rendering              | High       | High     | Centralize via `TASK_TOOL_NAMES = ["task", "agent"]` set + normalization helper; touch all sites in one task     |
| R2 | Fork mode shares parent message history → LLM context bloat                           | High       | Medium   | Cap forwarded messages by token budget; document the budget; add explicit token-count test                       |
| R3 | Background fiber outlives session disposal → memory leak                              | High       | High     | Register fibers in `InstanceState.make` scope; `addFinalizer` aborts all running bg tasks on instance disposal   |
| R4 | Notification injection races with parent's next user turn                             | Medium     | High     | Inject as `MessageV2.Part` on the next assistant message via Bus event; idempotent flush                         |
| R5 | `MessageV2.Part` variant addition breaks downstream consumers (TUI, web, share)       | Medium     | High     | Make new part type opt-in via discriminator; render as plain text in legacy consumers                            |
| R6 | Concurrent background tasks exceed provider rate limits                               | Medium     | Medium   | Per-provider concurrency bucket via existing semaphore primitives; configurable cap                              |
| R7 | Cancellation leaves orphan tool-result rows (subagent kept writing after abort)       | Medium     | Medium   | Use `Effect.onInterrupt` on the bg fiber to mark all pending parts as `error`/`cancelled` atomically             |
| R8 | Fork mode allows recursive fork (fork-of-fork) → infinite spawn                       | Low        | High     | Reject `task(prompt=...)` without `subagent_type` if the current agent is already a fork (cc119 line 309361)     |
| R9 | `task_status` / `task_cancel` permission rules unclear (everyone can cancel anyone's) | Low        | Medium   | Scope task_status/cancel to the parent session only; reject cross-session access with typed error                |
| R10| `Effect.orDie` at execute boundary loses cancellation cause                           | Low        | Low      | New typed `TaskCancelledError` for user-initiated cancel; `TaskBackgroundError` for spontaneous failures        |
| R11| Backward compat: existing prompts that send only `subagent_type` still work          | Low        | High     | Keep `subagent_type` field; only flip required→optional. Test that all 2153 existing tests still pass            |
| R12| OMO's delegate-task tool wraps opencode's task tool — adding fields could conflict    | Medium     | Medium   | OMO's wrapper already has its own schema; opencode additions are independent. Verify with OMO-side smoke test    |

---

## 5. Test Strategy

**Default**: TDD for every additive feature. Each task ships with at least one happy-path test and one negative-path test.

| Surface                            | Strategy                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Tool.Def.aliases` field           | Unit test on registry expansion: `task` and `agent` both appear in `tools()` listing with same execute identity            |
| Tool-name normalization helper     | Unit test: `isTaskToolName("task")` and `isTaskToolName("agent")` both return true                                          |
| Fork agent definition              | Test: agent registry contains `fork` builtin; permission set matches parent at dispatch time                                |
| `subagent_type` optional + fork    | Test: `task(prompt=..., description=...)` spawns fork; received `ops.prompt` input includes `forkContextMessages`           |
| Recursive fork rejection           | Test: invoking `task(prompt=...)` from inside a fork session yields typed `RecursiveForkError`                              |
| Background task registry           | Test: `register(task_id, fiber)` then `get(task_id)` returns; `cancel` aborts; finalizer clears entries on instance dispose |
| Bg task launch returns immediately | Test: `task(run_in_background: true)` returns within 50ms with `status: "async_launched"` + `task_id`                       |
| Completion notification            | Test: bg task completes → next assistant message has a `BackgroundTaskNotificationPart`                                     |
| `task_status` tool                 | Test: returns `{status: "running"}` mid-flight, `{status: "completed", output}` after, `{status: "failed", error}` on error |
| `task_cancel` tool                 | Test: cancels running fiber; subsequent `task_status` returns `{status: "killed"}`                                          |
| TUI/CLI tool-name compat           | Test: render path for a `tool === "agent"` part renders identically to `tool === "task"`                                    |

**Test command**: `cd packages/opencode && bun test test/<area>/`
**Pre-flight per task**: LSP diagnostics clean → typecheck clean → tests green for affected file(s) → full `bun test` before next task

---

## 6. Tasks

### Phase X — Tool-Name Aliasing Foundation (B6 prerequisite)

#### X1. Add `aliases` field to Tool.Def + alias-aware registry expansion

**Goal**: Allow a single Tool.Def to surface under multiple LLM-visible names while routing to one execute function.

**Acceptance**:
- `Tool.Def.aliases?: readonly string[]` field exists
- `ToolRegistry.tools()` expands aliased tools into one entry per alias (same execute, different `id`)
- `ToolRegistry.all()` and `ToolRegistry.ids()` continue to return the canonical tool list (NOT expanded — internal callers use IDs)
- New unit test: registering a tool with `aliases: ["foo"]` makes both `id` and `foo` appear in `tools()`

**Files**:
- MODIFY `packages/opencode/src/tool/tool.ts` — add `aliases?: readonly string[]` to `Def` interface (~3 LOC)
- MODIFY `packages/opencode/src/tool/registry.ts` — extend `tools()` to flatMap alias entries (~10 LOC)
- MODIFY `packages/opencode/test/tool/registry.test.ts` — add alias expansion test (~40 LOC)

**Effort**: Small (~1 hour)

---

#### X2. Centralized tool-name normalization (the actual B6 enabler)

**Goal**: Replace every `tool === "task"` / `tool.id === TaskTool.id` check with a name-set predicate so `agent` works everywhere.

**Acceptance**:
- New module `packages/opencode/src/tool/task-name.ts` exports:
  - `TASK_TOOL_NAMES = ["task", "agent"] as const`
  - `isTaskToolName(name: string): boolean`
- All call sites updated: `prompt.ts:561,581,660`, `registry.ts:296`, `cli/cmd/run.ts:424,479`, `tui/routes/session/index.tsx:1396,1587`, `tui/routes/session/permission.tsx:307`
- Permission rules accept either `task` or `agent` keys — but resolve to the same internal permission identifier (`task`)
- Test: parts with `tool === "agent"` are rendered correctly in TUI snapshot tests
- Test: permission rule keyed on `task` blocks `agent` invocations too (no permission bypass)

**Files**:
- NEW `packages/opencode/src/tool/task-name.ts` (~25 LOC)
- MODIFY `packages/opencode/src/session/prompt.ts` — 3 sites
- MODIFY `packages/opencode/src/tool/registry.ts` — 1 site (line 296)
- MODIFY `packages/opencode/src/cli/cmd/run.ts` — 2 sites
- MODIFY `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — 2 sites
- MODIFY `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx` — 1 site
- MODIFY `packages/opencode/src/permission/index.ts` — normalize permission key on input (`agent` → `task`)
- MODIFY `packages/opencode/src/tool/task.ts` — set `aliases: ["agent"]`
- NEW `packages/opencode/test/tool/task-name.test.ts` (~80 LOC)

**Effort**: Medium (~3 hours)

**Dependencies**: X1

---

### Phase Y — Fork Mode (B4)

#### Y1. Add `fork` builtin agent definition

**Goal**: Register a built-in agent named `fork` that inherits parent context.

**Acceptance**:
- `Agent.state` registers `fork` agent
- `mode: "subagent"`, `native: true`, `hidden: true` (not in `@` autocomplete)
- `permission: defaults` (inherits parent's full ruleset at dispatch — see Y2)
- `omit_project_context: false` (fork uses parent's context as-is)
- New `Agent.Info` field: `forks_parent_context?: boolean | "turn"` (mirrors cc119's `forksParentContext`)
- Test: `agent.get("fork")` returns the fork definition; `forks_parent_context === true`

**Files**:
- MODIFY `packages/opencode/src/agent/agent.ts` — add `forks_parent_context` to Info schema (~3 LOC); register `fork` builtin (~20 LOC)
- MODIFY `packages/opencode/test/agent/agent.test.ts` — add 2 tests (~50 LOC)

**Effort**: Small (~2 hours)

---

#### Y2. Make `subagent_type` optional in Task schema + fork dispatch

**Goal**: When `subagent_type` is omitted, treat the call as a fork. Reject if already inside a fork.

**Acceptance**:
- `parameters.subagent_type` becomes `.optional()`
- New runtime check at top of `run`:
  - If `subagent_type` omitted AND current agent has `forks_parent_context` truthy → typed `RecursiveForkError`
  - If `subagent_type` omitted → resolve to `agent.get("fork")`
  - Else → existing path
- Description for `subagent_type` updated: "Optional. Omit to spawn an implicit fork that inherits the parent's full conversation context."
- New typed error `RecursiveForkError` in `task-errors.ts`
- Test: omit `subagent_type` → fork spawned, child session has `forks_parent_context` agent
- Test: omit from inside fork → typed error
- Test: explicit `subagent_type` still works (regression)

**Files**:
- MODIFY `packages/opencode/src/tool/task.ts` — schema change, dispatch logic (~25 LOC)
- MODIFY `packages/opencode/src/tool/task-errors.ts` — add `RecursiveForkError` (~12 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 3 tests (~150 LOC)

**Effort**: Medium (~3 hours)

**Dependencies**: Y1

---

#### Y3. Plumb `forkContextMessages` into `SessionPrompt.PromptInput`

**Goal**: Allow `ops.prompt({ forkContextMessages: [...] })` to prepend parent's history into the subagent's message stream.

**Acceptance**:
- `SessionPrompt.PromptInput` interface gets new optional `forkContextMessages?: MessageV2.WithParts[]`
- `SessionPrompt.runLoop` (or equivalent) prepends these messages to the model-message list before the LLM call
- When omitted, behavior unchanged (subagent starts from empty history + system prompt)
- Token-budget check: if forwarded messages would exceed `cfg.task?.max_fork_context_tokens` (default: 80% of model context window), truncate from the oldest end with a `<truncated>` marker
- Test: subagent receives forwarded messages in `ops.prompt` call
- Test: token budget triggers truncation, prepends `<truncated>` marker
- Test: `forkContextMessages: []` (explicit empty) acts same as omitted

**Files**:
- MODIFY `packages/opencode/src/session/prompt.ts` — add field to `PromptInput`, integrate into `runLoop` message construction (~30 LOC)
- NEW `packages/opencode/src/session/fork-context.ts` — token-budget truncation logic (~80 LOC, single responsibility)
- MODIFY `packages/opencode/src/config/config.ts` — add `task.max_fork_context_tokens?: number` (~3 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 3 tests using stub `ops` to capture forwarded messages (~120 LOC)

**Effort**: Medium (~6 hours)

**Dependencies**: Y2

---

#### Y4. Wire fork dispatch in TaskTool to pass parent messages

**Goal**: When fork agent dispatches, pass parent session's messages to the subagent via `forkContextMessages`.

**Acceptance**:
- In `task.ts`, after resolving fork agent: `const parentMessages = ctx.messages` (already available in Tool.Context)
- Pass to `ops.prompt({ ..., forkContextMessages: next.forks_parent_context === "turn" ? lastTurn(parentMessages) : parentMessages })`
- `lastTurn(messages)` extracts messages since the last user turn
- Test: explicit fork call gets full history
- Test: agent definition with `forks_parent_context: "turn"` gets only the last turn

**Files**:
- MODIFY `packages/opencode/src/tool/task.ts` — pass `forkContextMessages` (~10 LOC)
- NEW `packages/opencode/src/session/last-turn.ts` — extract last turn helper (~50 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 2 tests (~80 LOC)

**Effort**: Small (~2 hours)

**Dependencies**: Y1, Y2, Y3

---

### Phase Z — Background Tasks (B3, the big one)

#### Z1. New `MessageV2.Part` variant: `BackgroundTaskNotificationPart`

**Goal**: Carry completion-notification XML on assistant messages without breaking existing parts.

**Acceptance**:
- New schema variant `BackgroundTaskNotificationPart` with fields: `task_id: string`, `agent_name: string`, `status: "completed" | "failed" | "killed"`, `summary: string`, `result?: string`, `error?: string`, `time: { start: number, end: number }`
- Discriminated by `type: "background_task_notification"` literal
- Added to `MessageV2.Part` union
- Stored in `parts` table the same as other parts (JSON column, no DDL)
- TUI/web renderers handle the new type as a styled banner; legacy consumers fall back to plain text
- Test: round-trip serialize/deserialize via Drizzle
- Test: legacy renderer (web share) does not crash on new part type

**Files**:
- MODIFY `packages/opencode/src/session/message-v2.ts` — add schema (~30 LOC)
- MODIFY `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — render handler (~25 LOC)
- MODIFY `packages/web/src/components/share/part.tsx` — fallback render (~15 LOC)
- MODIFY `packages/ui/src/components/message-part.tsx` — fallback render (~15 LOC)
- NEW `packages/opencode/test/session/message-v2-bg-notification.test.ts` (~80 LOC)

**Effort**: Medium (~5 hours)

---

#### Z2. Background task registry (per-Instance, in-memory)

**Goal**: Track running bg tasks keyed by `task_id`, abortable and cleanly disposed.

**Acceptance**:
- New `BackgroundTaskRegistry` service (`Context.Service`)
- Backed by `InstanceState.make` (per-directory cleanup)
- API:
  - `register(taskId: string, entry: { fiber: Fiber, agentId: string, agentName: string, parentSessionId: SessionID, abort: AbortController, startTime: number, status: "running" })`: void
  - `get(taskId: string)`: Effect<Entry | undefined>
  - `list(parentSessionId: SessionID)`: Effect<Entry[]>
  - `markCompleted(taskId, result)`: Effect<void>
  - `markFailed(taskId, error)`: Effect<void>
  - `markKilled(taskId)`: Effect<void>
  - `cancel(taskId)`: Effect<void> (aborts the fiber, marks killed)
- Finalizer in `InstanceState.make` aborts all running entries on instance disposal
- Cap: configurable `cfg.task?.max_concurrent_background?: number` (default: 8)
- Exceeding cap → typed `BackgroundTaskCapacityError`
- Test: register/get/list/cancel lifecycle
- Test: instance dispose aborts all running tasks
- Test: capacity exceeded yields typed error

**Files**:
- NEW `packages/opencode/src/task-background/registry.ts` — service definition (~150 LOC)
- NEW `packages/opencode/src/task-background/errors.ts` — typed errors (~40 LOC)
- NEW `packages/opencode/src/task-background/types.ts` — Entry shape (~30 LOC)
- MODIFY `packages/opencode/src/config/config.ts` — add `task.max_concurrent_background` (~3 LOC)
- NEW `packages/opencode/test/task-background/registry.test.ts` (~200 LOC)

**Effort**: Large (~1 day)

---

#### Z3. Add `run_in_background` to Task schema + async dispatch

**Goal**: When `run_in_background: true`, fork an Effect fiber, register in BackgroundTaskRegistry, return immediately with `task_id`.

**Acceptance**:
- `parameters.run_in_background?: boolean` added to schema
- New result shape (TypeScript discriminated union):
  - Sync (existing): `{ task_id, output: "<task_result>...</task_result>" }`
  - Async (new): `{ task_id, status: "async_launched", agent_name, started_at }`
- When `run_in_background: true`:
  - Generate `task_id` (existing `SessionID`)
  - Create child session
  - `Effect.forkIn(scope)` the prompt loop
  - Register entry in `BackgroundTaskRegistry`
  - Return immediately
- On fiber completion (success): `markCompleted(taskId, lastAssistantText)` AND inject `BackgroundTaskNotificationPart` into parent's next message via Bus event
- On fiber failure: `markFailed(taskId, errorMessage)` + same notification flow with `status: "failed"`
- On fiber interruption (user cancel): `markKilled(taskId)` + notification with `status: "killed"`
- Notification injection mechanism: publish `Session.Event.BackgroundTaskComplete` → handler in `session/prompt.ts` checks for pending notifications before each LLM turn and prepends them as message parts
- Test: launch returns within 50ms (uses TestClock)
- Test: completion injects notification part on parent
- Test: failure path captures error in notification
- Test: parallel launches respect concurrency cap
- Test: env var `OPENCODE_DISABLE_BACKGROUND_TASKS=1` strips `run_in_background` from schema (mirrors cc119 `MFH`)

**Files**:
- MODIFY `packages/opencode/src/tool/task.ts` — schema field (~5 LOC), async dispatch branch (~50 LOC) — likely pushes file over 200 LOC, extract async path
- NEW `packages/opencode/src/tool/task-async-dispatch.ts` — extracted async dispatch logic (~150 LOC)
- MODIFY `packages/opencode/src/session/session.ts` — add `BackgroundTaskComplete` entry to the existing `export const Event = { ... }` map (around line 254, alongside existing `Updated`, `Deleted`, `Idle`, etc.) (~10 LOC)
- MODIFY `packages/opencode/src/session/prompt.ts` — drain pending notifications before LLM call (~30 LOC)
- NEW `packages/opencode/src/session/background-notification-injector.ts` — single-responsibility module for the drain logic (~80 LOC)
- MODIFY `packages/opencode/src/flag/flag.ts` — add `OPENCODE_DISABLE_BACKGROUND_TASKS` (~2 LOC)
- MODIFY `packages/opencode/test/tool/task.test.ts` — add 5 tests (~300 LOC)
- NEW `packages/opencode/test/session/background-notification.test.ts` (~150 LOC)

**Effort**: Large (~2 days)

**Dependencies**: Z1, Z2

---

#### Z4. New `task_status` tool

**Goal**: LLM can poll a background task's state.

**Acceptance**:
- New tool `task_status` registered in builtin list
- Schema: `{ task_id: string }`
- Output (discriminated union):
  - `{ status: "running", agent_name, started_at, elapsed_ms }`
  - `{ status: "completed", agent_name, started_at, completed_at, output }`
  - `{ status: "failed", agent_name, started_at, failed_at, error }`
  - `{ status: "killed", agent_name, started_at, killed_at }`
  - `{ status: "unknown" }` (task_id never registered, or expired)
- Permission rule: `task_status:*` → `allow` by default; agents can deny via permission ruleset
- Looking up across sessions: only allowed within the same parent session — typed `TaskStatusCrossSessionError` otherwise
- Test: status "running" before completion
- Test: status "completed" after, includes output
- Test: status "failed" with error message
- Test: cross-session lookup → typed error

**Files**:
- NEW `packages/opencode/src/tool/task-status.ts` (~120 LOC)
- MODIFY `packages/opencode/src/tool/registry.ts` — register the new tool (~5 LOC)
- MODIFY `packages/opencode/src/task-background/errors.ts` — add `TaskStatusCrossSessionError` (~10 LOC)
- NEW `packages/opencode/test/tool/task-status.test.ts` (~200 LOC)

**Effort**: Medium (~6 hours)

**Dependencies**: Z2, Z3

---

#### Z5. New `task_cancel` tool

**Goal**: LLM can cancel a running background task.

**Acceptance**:
- New tool `task_cancel` registered
- Schema: `{ task_id: string }`
- Output: `{ status: "killed" | "already_completed" | "already_failed" | "unknown" }`
- Calls `BackgroundTaskRegistry.cancel(taskId)`
- Permission rule: `task_cancel:*` → `allow` by default
- Cross-session: same restriction as `task_status` (typed error)
- Test: cancel running task → status "killed", subsequent task_status reflects it
- Test: cancel already-completed task → "already_completed"
- Test: cancel unknown task → "unknown"

**Files**:
- NEW `packages/opencode/src/tool/task-cancel.ts` (~80 LOC)
- MODIFY `packages/opencode/src/tool/registry.ts` — register (~3 LOC)
- NEW `packages/opencode/test/tool/task-cancel.test.ts` (~150 LOC)

**Effort**: Medium (~4 hours)

**Dependencies**: Z2, Z3, Z4

---

#### Z6. Concurrency limiter on background launches

**Goal**: Prevent runaway parallel bg tasks from saturating provider quotas.

**Acceptance**:
- `BackgroundTaskRegistry` tracks per-instance `activeCount`
- `register()` rejects with `BackgroundTaskCapacityError` when `activeCount >= cfg.task.max_concurrent_background ?? 8`
- Per-provider sub-cap (optional, follow-up): `cfg.task.max_concurrent_background_per_provider?: Record<ProviderID, number>`
- Test: launch 8 tasks → all succeed
- Test: launch 9th → typed error
- Test: complete one task → can launch one more

**Files**:
- MODIFY `packages/opencode/src/task-background/registry.ts` — add active counter + cap check (~30 LOC)
- MODIFY `packages/opencode/test/task-background/registry.test.ts` — add 3 cap tests (~120 LOC)

**Effort**: Small (~3 hours)

**Dependencies**: Z2

---

#### Z7. Documentation + CLI surfacing

**Goal**: Make the new surface discoverable.

**Acceptance**:
- Update `packages/opencode/README.md` and `AGENTS.md` with `run_in_background` usage example
- Add a CLI command `opencode tasks` that lists running bg tasks (read-only convenience)
- Test: `opencode tasks` prints all running tasks for the active session

**Files**:
- MODIFY `packages/opencode/README.md` (~30 LOC docs)
- MODIFY `packages/opencode/AGENTS.md` (~20 LOC)
- NEW `packages/opencode/src/cli/cmd/tasks.ts` (~80 LOC)
- MODIFY `packages/opencode/src/index.ts` — register the new command alongside existing yargs `command()` calls (~3 LOC)
- NEW `packages/opencode/test/cli/tasks.test.ts` (~80 LOC)

**Effort**: Small (~3 hours)

**Dependencies**: Z2, Z3, Z4

---

## 6.5. QA Scenarios (Final Verification Wave)

Each scenario is a concrete reproduction the implementer runs after the task lands. Format: **Tool → Steps → Expected**.

### Y1. `fork` builtin agent definition
- **Tool**: `cd packages/opencode && bun test test/agent/agent.test.ts -t "fork agent"`
- **Steps**: 1) Boot Agent service in a fresh tmpdir Instance. 2) Call `agent.get("fork")`. 3) Inspect the returned `Info`.
- **Expected**: `{ name: "fork", mode: "subagent", native: true, hidden: true, forks_parent_context: true }` with the same `permission` ruleset shape as the parent's defaults.

### Y4. Fork dispatch passes parent messages
- **Tool**: `cd packages/opencode && bun test test/tool/task.test.ts -t "fork.*context"`
- **Steps**: 1) Stub `ops.prompt` to capture its `forkContextMessages` argument. 2) Seed parent session with 4 messages spanning 2 user turns. 3) Spawn fork via `task({prompt:"x", description:"y"})`. 4) Repeat with an agent definition whose `forks_parent_context: "turn"`.
- **Expected**: (3) Captured `forkContextMessages` deep-equals all 4 parent messages. (4) Captured `forkContextMessages` deep-equals only messages since the latest user turn (i.e. the last 2 messages).

### Z6. Concurrency limiter
- **Tool**: `cd packages/opencode && bun test test/task-background/registry.test.ts -t "concurrency"`
- **Steps**: 1) Set `cfg.task.max_concurrent_background = 8`. 2) Register 8 long-running stub fibers via `BackgroundTaskRegistry.register`. 3) Try to register a 9th. 4) `markCompleted` one task. 5) Try to register a new task again.
- **Expected**: (3) Yields typed `BackgroundTaskCapacityError` with `current: 8` / `cap: 8` / `requested_agent` populated. (5) Succeeds (slot freed by step 4).

### Z7. Docs + CLI surfacing
- **Tool**: 1) `cd packages/opencode && bun typecheck && bun run build` 2) `node packages/opencode/dist/index.js tasks --help` 3) snapshot the README + AGENTS.md sections that mention `run_in_background`
- **Steps**: 1) Confirm typecheck green. 2) Run the CLI command. 3) Trigger `tasks` while a bg task is running.
- **Expected**: (2) Help text lists the `tasks` subcommand with `--session-id` and a description. (3) Output prints active task IDs, agents, started_at timestamps, and elapsed durations for the active session only. (4) README + AGENTS.md sections include at least one minimal `task(run_in_background: true)` example with the returned `task_id` shape.

### X1. `Tool.Def.aliases` field
- **Tool**: `cd packages/opencode && bun test test/tool/registry.test.ts -t "alias expansion"`
- **Steps**: Register a stub Tool.Def with `aliases: ["foo"]`. Call `registry.tools()`. Inspect returned list.
- **Expected**: Two entries — one with original `id`, one with `id: "foo"`. Both have identical `execute` reference. `registry.all()` and `registry.ids()` return only the canonical entry.

### X2. Tool-name normalization
- **Tool**: `cd packages/opencode && bun test test/tool/task-name.test.ts && bun test test/tool/task.test.ts`
- **Steps**: 1) Unit-test `isTaskToolName("task")`, `isTaskToolName("agent")`, `isTaskToolName("other")`. 2) Snapshot a TUI tool-part rendered with `tool === "agent"` and confirm it matches `tool === "task"` rendering. 3) Set permission rule `task: deny` and invoke `agent(...)` — must be denied.
- **Expected**: Both names predicate-true; identical TUI render; permission denial blocks both names.

### Y2. Optional `subagent_type` + fork dispatch
- **Tool**: `cd packages/opencode && bun test test/tool/task.test.ts -t "fork"`
- **Steps**: 1) Call `task({ description: "x", prompt: "y" })` (no subagent_type) from the `build` agent. 2) Capture the `ops.prompt` input via stub. 3) Repeat call from inside a session whose agent has `forks_parent_context: true`.
- **Expected**: (1) Subagent dispatched with `agent: "fork"` and parent's full `messages[]` flow into `forkContextMessages`. (3) Yields typed `RecursiveForkError` with message identifying the fork-from-fork attempt.

### Y3. Token-budget truncation
- **Tool**: `cd packages/opencode && bun test test/tool/task.test.ts -t "fork.*budget"`
- **Steps**: Seed a parent session with messages totaling > `cfg.task.max_fork_context_tokens`. Spawn fork. Capture forwarded messages.
- **Expected**: Oldest messages dropped from the front; first surviving message preceded by a `<truncated>` synthetic part. Total token count ≤ budget.

### Z1. `BackgroundTaskNotificationPart` round-trip
- **Tool**: `cd packages/opencode && bun test test/session/message-v2-bg-notification.test.ts`
- **Steps**: 1) Construct a part with all required fields. 2) Persist via `sessions.updatePart`. 3) Read back via `MessageV2.get`. 4) Render via legacy web `share/part.tsx` consumer.
- **Expected**: Round-trip preserves every field; legacy renderer emits a graceful fallback (no crash).

### Z2. Background registry lifecycle
- **Tool**: `cd packages/opencode && bun test test/task-background/registry.test.ts`
- **Steps**: 1) Register 3 tasks → `list(parentSessionID)` returns all 3. 2) `cancel(taskId)` → status flips to `killed`. 3) Dispose Instance via `Instance.disposeAll()` → all running fibers aborted within 100ms.
- **Expected**: Lifecycle transitions match `markCompleted/markFailed/markKilled` API. Dispose finalizer aborts all fibers (assert via `fiber.exit` reporting `interrupted`).

### Z3. `run_in_background` end-to-end
- **Tool**: `cd packages/opencode && bun test test/tool/task.test.ts -t "run_in_background"` AND a manual TUI session
- **Steps**: 1) Call `task({ subagent_type: "general", prompt: "echo hi", run_in_background: true })`. Measure return latency. 2) Wait for completion. Inspect parent's next assistant message. 3) Repeat with `OPENCODE_DISABLE_BACKGROUND_TASKS=1`.
- **Expected**: (1) Returns within 50ms with `{status: "async_launched", task_id, agent_name, started_at}`. (2) Parent message contains a `BackgroundTaskNotificationPart` with `status: "completed"` and the subagent's last text. (3) Schema rejects `run_in_background` field with a Zod validation error.

### Z4. `task_status` tool
- **Tool**: `cd packages/opencode && bun test test/tool/task-status.test.ts`
- **Steps**: 1) Launch bg task. Immediately call `task_status(task_id)`. 2) Wait for completion. Call again. 3) Cause failure mid-flight (mock provider error). Call status. 4) Call status with a task_id from a different parent session.
- **Expected**: (1) `{status: "running", elapsed_ms: <small>}`. (2) `{status: "completed", output: "<task subagent's last text>"}`. (3) `{status: "failed", error: "<message>"}`. (4) Typed `TaskStatusCrossSessionError`.

### Z5. `task_cancel` tool
- **Tool**: `cd packages/opencode && bun test test/tool/task-cancel.test.ts`
- **Steps**: 1) Launch bg task. Call `task_cancel(task_id)` mid-flight. 2) Call `task_status(task_id)`. 3) Try to cancel an already-completed task. 4) Try to cancel an unknown task_id.
- **Expected**: (1) Returns `{status: "killed"}`. (2) Status reflects `killed`, fiber is aborted (no further messages appended to subagent session). (3) Returns `{status: "already_completed"}`. (4) Returns `{status: "unknown"}`.

### Cross-cutting smoke
- **Tool**: full opencode test suite + manual session
- **Steps**: 1) `cd packages/opencode && bun typecheck` against the branch baseline established at plan start (use `git stash -u && bun typecheck` to capture baseline error count, then re-run after changes). 2) `cd packages/opencode && bun test`. 3) Manual: open opencode TUI, call each new tool from a real LLM session.
- **Expected**: (1) typecheck reports the SAME error count as the captured baseline (zero new errors introduced; pre-existing errors unchanged). (2) ≥ 2153 tests pass; new tests cover every new surface; no regression. (3) LLM successfully invokes `task(run_in_background: true)`, gets task_id, calls `task_status`, sees notification on completion.

---

## 7. Execution Order

```
Phase X (B6 prerequisite — small, foundation):
  X1 (Tool.Def.aliases)         ──┐
  X2 (name normalization)        ──┘ depends on X1, then independent of all Phase Y/Z

Phase Y (B4 fork — medium):
  Y1 (fork agent definition)     ──┐
  Y2 (subagent_type optional)    ──┘ depends on Y1
  Y3 (forkContextMessages plumb) ──── depends on Y2
  Y4 (wire fork dispatch)        ──── depends on Y1, Y2, Y3

Phase Z (B3 background — large):
  Z1 (notification part type)    ──┐ independent foundation
  Z2 (background registry)       ──┤ independent foundation
  Z3 (run_in_background dispatch)──── depends on Z1, Z2
  Z4 (task_status tool)          ──── depends on Z2, Z3
  Z5 (task_cancel tool)          ──── depends on Z2, Z3, Z4
  Z6 (concurrency limiter)       ──── depends on Z2 (can land in parallel with Z3)
  Z7 (docs + CLI)                ──── depends on Z2, Z3, Z4

Suggested landing order: X1 → X2 → Y1 → Y2 → Y3 → Y4 → Z1 → Z2 → Z6 → Z3 → Z4 → Z5 → Z7
Total: 13 tasks
```

---

## 8. Phase Verification Gates

**End of Phase X (B6)**:
- LLM can invoke `agent(...)` and `task(...)` interchangeably
- TUI renders `tool === "agent"` parts identically to `tool === "task"`
- All permission rules apply to both names
- `bun test` full suite green

**End of Phase Y (B4)**:
- LLM can invoke `task(prompt=..., description=...)` (no `subagent_type`) and the subagent receives parent's messages
- Recursive fork from inside a fork yields typed error
- Token-budget truncation works (verifiable via stub `ops`)
- `bun test` full suite green

**End of Phase Z (B3)**:
- LLM can invoke `task(..., run_in_background: true)` and immediately get a `task_id`
- On completion, parent's next assistant message includes a notification part
- `task_status(task_id)` returns running/completed/failed/killed
- `task_cancel(task_id)` aborts and reports
- 9th concurrent bg task rejected with typed error
- `bun test` full suite green

---

## 9. Open Decisions Pending User Input

1. **Z3 notification injection mechanism**: should the notification be a *new message* (cleaner UX) or a *part on the existing message* (lower latency)? Recommend: part on next assistant message, but flag for review.
2. **Z2 registry persistence**: in-memory is documented as "CLI restart kills bg tasks". Acceptable or do we need disk persistence (much larger scope)? Recommend: in-memory for v1, persist in v2.
3. **Y3 token budget**: default 80% of model context window. Per-model override via config? Recommend: yes, via `cfg.task.max_fork_context_tokens` global, plus per-agent `forks_parent_context_max_tokens`.
4. **Y2 + B4 + omo BG manager interaction**: OMO's BackgroundManager (2349 LOC) wraps opencode's task tool externally. With opencode native bg, OMO BG should become an adapter. Out of scope for THIS plan — handled in parent plan's C3.
5. **Z3 notification type field naming**: `type: "background_task_notification"` or shorter `type: "task_notification"`? Recommend: full name for clarity.
6. **Z4 `task_status` cross-session restriction**: Hard restrict (typed error) or soft (return `unknown` for foreign IDs)? Recommend: typed error, more debuggable.
7. **Z6 default cap**: 8 concurrent bg tasks. Reasonable for the workload? Configurable anyway.
8. **X2 permission key normalization**: should `permission.task = "deny"` also block `agent` invocations? Recommend: YES, normalize at permission evaluation time.
9. **Should this plan go through Momus high-accuracy review?** Recommend: YES given the scope.

---

## 10. Estimated Total Effort

| Phase  | Tasks | Effort                |
| ------ | ----- | --------------------- |
| X (B6) | 2     | ~4 hours              |
| Y (B4) | 4     | ~13 hours             |
| Z (B3) | 7     | ~5 days               |
| **Total** | **13** | **~7 working days**   |

(Solo developer estimate. Phase X is pure parallelization unblocker. Phase Y can start after X1 lands. Phase Z is largely independent of X/Y but Z7 depends on Z3-Z4.)
