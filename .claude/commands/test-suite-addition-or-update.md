---
name: test-suite-addition-or-update
description: Workflow command scaffold for test-suite-addition-or-update in opencode.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /test-suite-addition-or-update

Use this workflow when working on **test-suite-addition-or-update** in `opencode`.

## Goal

Adds or updates a feature and its corresponding tests, often for e2e or unit/integration coverage.

## Common Files

- `packages/opencode/src/account/index.ts`
- `packages/opencode/test/account/service.test.ts`
- `packages/opencode/src/file/time.ts`
- `packages/opencode/test/file/time.test.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/test/session/prompt-effect.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit or add implementation files (e.g., src/...)
- Edit or add corresponding test files (e.g., test/..., e2e/...)

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.