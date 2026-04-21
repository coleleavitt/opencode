import { describe, test, expect } from "bun:test"
import { Snapshot } from "../../src/snapshot"
import { createTwoFilesPatch } from "diff"
import { getSingularPatch } from "@pierre/diffs"

const CAP = 256 * 1024

function diff(opts: Partial<Snapshot.FileDiff> & { file: string }): Snapshot.FileDiff {
  return {
    before: "",
    after: "",
    additions: 0,
    deletions: 0,
    ...opts,
  }
}

describe("capFileDiffs", () => {
  test("patch present + oversized before/after drops content, keeps patch", () => {
    const big = "x".repeat(CAP + 1)
    const patch = "@@ -1,1 +1,1 @@\n-old\n+new"
    const result = Snapshot.capFileDiffs([
      diff({ file: "a.ts", before: big, after: big, patch, additions: 1, deletions: 1 }),
    ])
    expect(result[0].before).toBe("")
    expect(result[0].after).toBe("")
    expect(result[0].patch).toBe(patch)
  })

  test("no patch + oversized drops before/after (legacy behavior)", () => {
    const big = "y".repeat(CAP + 1)
    const result = Snapshot.capFileDiffs([diff({ file: "b.ts", before: big, after: big, additions: 1, deletions: 1 })])
    expect(result[0].before).toBe("")
    expect(result[0].after).toBe("")
    expect(result[0].patch).toBeUndefined()
  })

  test("small content is unchanged", () => {
    const patch = "@@ -1 +1 @@\n-hello\n+world"
    const input = diff({ file: "c.ts", before: "hello", after: "world", patch, additions: 1, deletions: 1 })
    const result = Snapshot.capFileDiffs([input])
    expect(result[0]).toBe(input)
  })

  test("patch present + small before/after preserved", () => {
    const patch = "@@ -1 +1 @@\n-a\n+b"
    const input = diff({ file: "d.ts", before: "a", after: "b", patch, additions: 1, deletions: 1 })
    const result = Snapshot.capFileDiffs([input])
    expect(result[0].before).toBe("a")
    expect(result[0].after).toBe("b")
    expect(result[0].patch).toBe(patch)
  })

  test("exactly at cap boundary is not dropped", () => {
    const exact = "z".repeat(CAP)
    const input = diff({ file: "e.ts", before: exact, after: exact, additions: 0, deletions: 0 })
    const result = Snapshot.capFileDiffs([input])
    expect(result[0]).toBe(input)
  })

  test("mixed array: only oversized entries are capped", () => {
    const big = "w".repeat(CAP + 1)
    const small = diff({ file: "small.ts", before: "ok", after: "ok", additions: 0, deletions: 0 })
    const large = diff({ file: "large.ts", before: big, after: big, patch: "@@", additions: 1, deletions: 1 })
    const result = Snapshot.capFileDiffs([small, large])
    expect(result[0]).toBe(small)
    expect(result[1].before).toBe("")
    expect(result[1].after).toBe("")
    expect(result[1].patch).toBe("@@")
  })
})

describe("patch roundtrip via getSingularPatch", () => {
  test("createTwoFilesPatch → getSingularPatch produces valid metadata", () => {
    const patch = createTwoFilesPatch("test.ts", "test.ts", "hello\n", "hello\nworld\n")
    const meta = getSingularPatch(patch)
    expect(meta.isPartial).toBe(true)
    expect(meta.hunks.length).toBeGreaterThan(0)
    expect(meta.additionLines.some((l) => l.includes("world"))).toBe(true)
  })

  test("added file: empty before produces all + lines", () => {
    const patch = createTwoFilesPatch("new.ts", "new.ts", "", "new content\n")
    expect(patch).toContain("+new content")
    const meta = getSingularPatch(patch)
    expect(meta.hunks.length).toBeGreaterThan(0)
  })

  test("deleted file: empty after produces all - lines", () => {
    const patch = createTwoFilesPatch("old.ts", "old.ts", "old content\n", "")
    expect(patch).toContain("-old content")
    const meta = getSingularPatch(patch)
    expect(meta.hunks.length).toBeGreaterThan(0)
  })
})
