import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@opencode-ai/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import { Log } from "@/util/log"
import type { Path } from "@opencode-ai/sdk"

// Streaming event batcher: batch ALL high-frequency events during streaming
// to reduce store mutations and avoid GC pressure from markdown re-parsing.
// Events are buffered and flushed every BATCH_FLUSH_MS in a single batch() call.
const BATCH_FLUSH_MS = 100
const pendingDeltas = new Map<string, Map<string, Map<string, string>>>()
const pendingStatus = new Map<string, SessionStatus>()
const pendingMessages = new Map<string, Message>()
const pendingParts = new Map<string, Part>()
const pendingTodos = new Map<string, Todo[]>()
const pendingDiffs = new Map<string, import("@/snapshot").Snapshot.FileDiff[]>()
let batchTimer: Timer | undefined

function scheduleBatchFlush(setStore: any, store: any) {
  if (batchTimer) return
  batchTimer = setTimeout(() => {
    batchTimer = undefined
    // Snapshot and clear all pending state
    const deltas = new Map(pendingDeltas)
    const statuses = new Map(pendingStatus)
    const messages = new Map(pendingMessages)
    const parts = new Map(pendingParts)
    const todos = new Map(pendingTodos)
    const diffs = new Map(pendingDiffs)
    pendingDeltas.clear()
    pendingStatus.clear()
    pendingMessages.clear()
    pendingParts.clear()
    pendingTodos.clear()
    pendingDiffs.clear()

    batch(() => {
      // Flush session statuses
      for (const [sessionID, status] of statuses) {
        setStore("session_status", sessionID, status)
      }

      // Flush todos
      for (const [sessionID, todoList] of todos) {
        setStore("todo", sessionID, todoList)
      }

      // Flush diffs
      for (const [sessionID, diff] of diffs) {
        setStore("session_diff", sessionID, diff)
      }

      // Flush message updates
      for (const [, info] of messages) {
        const existing = store.message[info.sessionID]
        if (!existing) {
          setStore("message", info.sessionID, [info])
          continue
        }
        const result = Binary.search(existing, info.id, (m: any) => m.id)
        if (result.found) {
          setStore("message", info.sessionID, result.index, reconcile(info))
          continue
        }
        setStore(
          "message",
          info.sessionID,
          produce((draft: any[]) => {
            draft.splice(result.index, 0, info)
          }),
        )
        const updated = store.message[info.sessionID]
        if (updated.length > 100) {
          const oldest = updated[0]
          setStore(
            "message",
            info.sessionID,
            produce((draft: any[]) => {
              draft.shift()
            }),
          )
          setStore(
            "part",
            produce((draft: any) => {
              delete draft[oldest.id]
            }),
          )
        }
      }

      // Flush part updates
      for (const [, part] of parts) {
        const existing = store.part[part.messageID]
        if (!existing) {
          setStore("part", part.messageID, [part])
          continue
        }
        const result = Binary.search(existing, part.id, (p: any) => p.id)
        if (result.found) {
          setStore("part", part.messageID, result.index, reconcile(part))
          continue
        }
        setStore(
          "part",
          part.messageID,
          produce((draft: any[]) => {
            draft.splice(result.index, 0, part)
          }),
        )
      }

      // Flush deltas (accumulated text appends)
      for (const [msgID, partMap] of deltas) {
        const existing = store.part[msgID]
        if (!existing) continue
        setStore(
          "part",
          msgID,
          produce((draft: any[]) => {
            for (const [pID, fields] of partMap) {
              const idx = Binary.search(draft, pID, (p: any) => p.id)
              if (!idx.found) continue
              const p = draft[idx.index]
              for (const [f, d] of fields) {
                const key = f as keyof typeof p
                ;(p[key] as string) = ((p[key] as string | undefined) ?? "") + d
              }
            }
          }),
        )
      }
    })
  }, BATCH_FLUSH_MS)
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: Path
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { state: "", config: "", worktree: "", directory: "" },
    })

    const sdk = useSDK()

    sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "server.instance.disposed":
          bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          pendingTodos.set(event.properties.sessionID, event.properties.todos)
          scheduleBatchFlush(setStore, store)
          break

        case "session.diff":
          pendingDiffs.set(event.properties.sessionID, event.properties.diff)
          scheduleBatchFlush(setStore, store)
          break

        case "session.deleted": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          pendingStatus.set(event.properties.sessionID, event.properties.status)
          scheduleBatchFlush(setStore, store)
          break
        }

        case "message.updated": {
          pendingMessages.set(event.properties.info.id, event.properties.info)
          scheduleBatchFlush(setStore, store)
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          pendingDeltas.get(event.properties.part.messageID)?.delete(event.properties.part.id)
          pendingParts.set(event.properties.part.id, event.properties.part)
          scheduleBatchFlush(setStore, store)
          break
        }

        case "message.part.delta": {
          const { messageID, partID, field, delta } = event.properties
          let byMessage = pendingDeltas.get(messageID)
          if (!byMessage) {
            byMessage = new Map()
            pendingDeltas.set(messageID, byMessage)
          }
          let byPart = byMessage.get(partID)
          if (!byPart) {
            byPart = new Map()
            byMessage.set(partID, byPart)
          }
          byPart.set(field, (byPart.get(field) ?? "") + delta)
          scheduleBatchFlush(setStore, store)
          break
        }

        case "message.part.removed": {
          pendingDeltas.get(event.properties.messageID)?.delete(event.properties.partID)
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          sdk.client.lsp.status().then((x) => setStore("lsp", x.data!))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap() {
      console.log("bootstrapping")
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.session
        .list({ start: start })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({}, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({}, { throwOnError: true })
      const agentsPromise = sdk.client.app.agents({}, { throwOnError: true })
      const configPromise = sdk.client.config.get({}, { throwOnError: true })
      const blockingRequests: Promise<unknown>[] = [
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const agents = responses[2]
            const config = responses[3]
            const sessions = responses[4]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            sdk.client.command.list().then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!))),
            sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data!))),
            sdk.client.experimental.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!))),
            sdk.client.session.status().then((x) => {
              setStore("session_status", reconcile(x.data!))
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get().then((x) => setStore("vcs", reconcile(x.data))),
            sdk.client.path.get().then((x) => setStore("path", reconcile(x.data!))),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      bootstrap()
    })

    const fullSyncedSessions = new Set<string>()
    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.message[sessionID] = messages.data!.map((x) => x.info)
              for (const message of messages.data!) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
          fullSyncedSessions.add(sessionID)
        },
      },
      bootstrap,
    }
    return result
  },
})
