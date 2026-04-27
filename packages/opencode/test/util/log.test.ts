import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Schema } from "effect"
import { Global } from "../../src/global"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

const log = Global.Path.log

afterEach(() => {
  Global.Path.log = log
})

async function files(dir: string) {
  let last = ""
  let same = 0

  for (let i = 0; i < 50; i++) {
    const list = (await fs.readdir(dir)).sort()
    const next = JSON.stringify(list)
    same = next === last ? same + 1 : 0
    if (same >= 2 && list.length === 11) return list
    last = next
    await Bun.sleep(10)
  }

  return (await fs.readdir(dir)).sort()
}

class CustomError extends Error {
  override readonly name = "CustomError"
}

class TaggedError extends Schema.TaggedErrorClass<TaggedError>()("MyTaggedError", {
  detail: Schema.String,
}) {
  override get message() {
    return `tagged failure: ${this.detail}`
  }
}

async function captureLogOutput(fn: (logger: ReturnType<typeof Log.create>) => void) {
  await using tmp = await tmpdir()
  Global.Path.log = tmp.path
  await Log.init({ print: false, dev: true })
  const logger = Log.create({ service: "log-test-" + Math.random().toString(36).slice(2, 8) })
  fn(logger)
  // Log writes go through createWriteStream with no exposed flush; poll until the write surfaces.
  for (let i = 0; i < 10; i++) {
    const contents = await fs.readFile(path.join(tmp.path, "dev.log"), "utf8").catch(() => "")
    if (contents.length > 0) return contents
    await Bun.sleep(20)
  }
  return await fs.readFile(path.join(tmp.path, "dev.log"), "utf8").catch(() => "")
}

test("formatError emits class name + message for plain Error subclass", async () => {
  const out = await captureLogOutput((logger) => {
    logger.error("oops", { error: new CustomError("boom") })
  })
  expect(out).toContain("[CustomError]")
  expect(out).toContain("boom")
})

test("formatError emits class name + message for Schema.TaggedErrorClass", async () => {
  const out = await captureLogOutput((logger) => {
    logger.error("oops", { error: new TaggedError({ detail: "nope" }) })
  })
  expect(out).toContain("[TaggedError]")
  expect(out).toContain("tagged failure: nope")
  expect(out).toContain('data={"detail":"nope"}')
})

test("formatError walks cause chain", async () => {
  const inner = new CustomError("inner reason")
  const outer = new Error("outer wrap", { cause: inner })
  const out = await captureLogOutput((logger) => {
    logger.error("oops", { error: outer })
  })
  expect(out).toContain("outer wrap")
  expect(out).toContain("Caused by:")
  expect(out).toContain("[CustomError]")
  expect(out).toContain("inner reason")
})

test("formatError handles error with no message", async () => {
  const err = new CustomError("")
  const out = await captureLogOutput((logger) => {
    logger.error("oops", { error: err })
  })
  expect(out).toContain("[CustomError]")
  expect(out).toContain("(no message)")
})

test("init cleanup keeps the newest timestamped logs", async () => {
  await using tmp = await tmpdir()
  Global.Path.log = tmp.path

  const list = Array.from({ length: 12 }, (_, i) => `2000-01-${String(i + 1).padStart(2, "0")}T000000.log`)

  await Promise.all(list.map((file) => fs.writeFile(path.join(tmp.path, file), file)))

  await Log.init({ print: false, dev: false })

  const next = await files(tmp.path)

  expect(next).not.toContain(list[0]!)
  expect(next).toContain(list.at(-1)!)
})
