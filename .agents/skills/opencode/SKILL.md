```markdown
# opencode Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches you how to contribute to the `opencode` TypeScript monorepo, which uses the Hono framework. You'll learn the project's coding conventions, commit patterns, and the main workflows for adding features, refactoring, testing, and extending plugins/providers. The guide includes step-by-step instructions and code examples to help you follow best practices and maintain consistency.

## Coding Conventions

- **File Naming:** Use `camelCase` for file and directory names.
  - Example: `timeUtils.ts`, `promptEffect.test.ts`
- **Import Style:** Use relative imports for modules within the package.
  - Example:
    ```typescript
    import { getTime } from './timeUtils';
    ```
- **Export Style:** Prefer named exports.
  - Example:
    ```typescript
    // Good
    export function getTime() { ... }

    // Avoid default exports
    // export default function getTime() { ... }
    ```
- **Commit Messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/) with these prefixes: `fix`, `chore`, `refactor`, `test`, `feat`.
  - Example: `feat(account): add OAuth support`
- **File Structure:** Implementation files are in `src/`, tests in `test/` or `e2e/`.

## Workflows

### Test Suite Addition or Update
**Trigger:** When developing a new feature or fixing a bug that requires new or updated tests.  
**Command:** `/add-test-suite`

1. Edit or add implementation files (e.g., `src/account/index.ts`).
2. Edit or add corresponding test files (e.g., `test/account/service.test.ts`).
3. Ensure Playwright tests cover new/changed logic.
4. Commit with a conventional message, e.g., `feat(account): add password reset and tests`.

**Example:**
```typescript
// src/account/index.ts
export function resetPassword(email: string) { ... }

// test/account/service.test.ts
import { resetPassword } from '../../src/account/index';
test('resets password', async () => { ... });
```

---

### Chore Generate or Autogen
**Trigger:** When modifying files that require regeneration of outputs (types, migrations, configs, etc).  
**Command:** `/generate`

1. Edit source, config, or test files.
2. Run code generation scripts (e.g., `npm run generate`).
3. Commit both source and generated files.
4. Use a `chore` commit, e.g., `chore(types): regenerate provider types`.

**Example:**
```bash
# After editing a schema or config
npm run generate
git add .
git commit -m "chore(types): regenerate provider types"
```

---

### Refactor Implementation and Tests
**Trigger:** When refactoring a module, service, or API and updating tests to match.  
**Command:** `/refactor-with-tests`

1. Refactor implementation files (e.g., `src/session/processor.ts`).
2. Update or refactor corresponding test files (e.g., `test/session/processor-effect.test.ts`).
3. Run tests to verify correctness.
4. Commit with `refactor` prefix, e.g., `refactor(session): simplify processor logic and tests`.

**Example:**
```typescript
// src/session/processor.ts
export function processSession(session) { ... }

// test/session/processor-effect.test.ts
import { processSession } from '../../src/session/processor';
test('processes session correctly', () => { ... });
```

---

### Feature or Fix Across Implementation and Tests
**Trigger:** When adding a new feature or fixing a bug and ensuring it is tested.  
**Command:** `/feature-with-tests`

1. Edit or add implementation files.
2. Edit or add corresponding test files.
3. Run all tests.
4. Commit with `feat` or `fix` prefix, e.g., `fix(snapshot): handle empty state and add tests`.

---

### Plugin or Provider Extension
**Trigger:** When adding or extending plugin/provider capabilities.  
**Command:** `/add-plugin`

1. Edit or add plugin/provider implementation files (e.g., `src/plugin/install.ts`).
2. Edit or add corresponding test files (e.g., `test/plugin/install.test.ts`).
3. Run tests to ensure plugin/provider works as expected.
4. Commit with `feat(plugin)` or similar.

**Example:**
```typescript
// src/plugin/install.ts
export function installPlugin(name: string) { ... }

// test/plugin/install.test.ts
import { installPlugin } from '../../src/plugin/install';
test('installs plugin', () => { ... });
```

## Testing Patterns

- **Framework:** [Playwright](https://playwright.dev/) is used for testing.
- **File Pattern:** Test files are named `*.spec.ts` or `*.test.ts` and placed in `test/` or `e2e/` directories.
- **Structure:**
  - Import the module under test using relative paths.
  - Use named exports for functions/classes.
  - Write clear, isolated tests for each feature or bug fix.

**Example:**
```typescript
// test/file/time.test.ts
import { getTime } from '../../src/file/time';

test('returns correct time', () => {
  expect(getTime()).toBeDefined();
});
```

## Commands

| Command              | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| /add-test-suite      | Add or update a feature and its corresponding tests            |
| /generate            | Run code generation or update generated files                  |
| /refactor-with-tests | Refactor implementation and update corresponding tests         |
| /feature-with-tests  | Implement a new feature or fix and ensure it is tested         |
| /add-plugin          | Add or extend plugin/provider capabilities and related tests   |
```
