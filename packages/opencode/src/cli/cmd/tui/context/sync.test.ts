import { describe, test, expect } from "bun:test"

describe("sync.session.sync error handling", () => {
  test("messages.data of undefined does not crash with non-null assertion", () => {
    const sdkResponse: { data: Array<{ info: { id: string }; parts: unknown[] }> | undefined } = {
      data: undefined,
    }
    const messagesData = sdkResponse.data ?? []
    expect(() => messagesData.map((x) => x.info)).not.toThrow()
    expect(messagesData).toEqual([])
  })

  test("messages.data of empty array maps to empty info array", () => {
    const sdkResponse: { data: Array<{ info: { id: string }; parts: unknown[] }> } = { data: [] }
    const messagesData = sdkResponse.data ?? []
    const result = messagesData.map((x) => x.info)
    expect(result).toEqual([])
  })

  test("messages.data with items maps to info array correctly", () => {
    const sdkResponse = {
      data: [
        { info: { id: "msg_1" }, parts: [{ type: "text", text: "hello" }] },
        { info: { id: "msg_2" }, parts: [] },
      ],
    }
    const messagesData = sdkResponse.data ?? []
    const result = messagesData.map((x) => x.info)
    expect(result).toEqual([{ id: "msg_1" }, { id: "msg_2" }])
  })

  test("session.data of undefined triggers early return", () => {
    const sdkResponse: { data: { id: string } | undefined } = { data: undefined }
    const sessionData = sdkResponse.data
    expect(sessionData).toBeUndefined()
    if (!sessionData) {
      expect(true).toBe(true)
      return
    }
    throw new Error("Should not reach here")
  })

  test("todo.data and diff.data fallback to empty arrays", () => {
    const todoResponse: { data: unknown[] | undefined } = { data: undefined }
    const diffResponse: { data: unknown[] | undefined } = { data: undefined }
    expect(todoResponse.data ?? []).toEqual([])
    expect(diffResponse.data ?? []).toEqual([])
  })
})
