import { describe, expect, test } from "bun:test"
import path from "path"
import { Flag } from "../../src/flag/flag"
import { Global } from "../../src/global"
import { InstallationChannel } from "../../src/installation/version"
import { Database } from "../../src/storage"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    const useUnchanneled =
      ["latest", "beta", "prod"].includes(InstallationChannel) || Flag.OPENCODE_DISABLE_CHANNEL_DB
    const expected = useUnchanneled
      ? path.join(Global.Path.data, "opencode.db")
      : path.join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
    expect(Database.getChannelPath()).toBe(expected)
  })
})
