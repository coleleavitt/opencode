import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect"
import type { SessionID } from "../session/schema"
import type { MessageV2 } from "../session/message-v2"

export type PendingNotification = Omit<MessageV2.BackgroundTaskNotificationPart, "id" | "messageID" | "sessionID">

interface State {
  readonly bySession: Map<SessionID, PendingNotification[]>
}

export interface Interface {
  readonly enqueue: (parentSessionId: SessionID, notification: PendingNotification) => Effect.Effect<void>
  readonly drain: (parentSessionId: SessionID) => Effect.Effect<PendingNotification[]>
  readonly peek: (parentSessionId: SessionID) => Effect.Effect<PendingNotification[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PendingTaskNotifications") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("PendingTaskNotifications.state")(function* () {
        return { bySession: new Map() } satisfies State
      }),
    )

    const enqueue: Interface["enqueue"] = Effect.fn("PendingTaskNotifications.enqueue")(function* (
      parentSessionId,
      notification,
    ) {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.sync(() => {
          const list = s.bySession.get(parentSessionId) ?? []
          list.push(notification)
          s.bySession.set(parentSessionId, list)
        }),
      )
    })

    const drain: Interface["drain"] = Effect.fn("PendingTaskNotifications.drain")(function* (parentSessionId) {
      return yield* InstanceState.useEffect(state, (s) =>
        Effect.sync(() => {
          const list = s.bySession.get(parentSessionId) ?? []
          s.bySession.delete(parentSessionId)
          return list
        }),
      )
    })

    const peek: Interface["peek"] = Effect.fn("PendingTaskNotifications.peek")(function* (parentSessionId) {
      return yield* InstanceState.useEffect(state, (s) => Effect.sync(() => [...(s.bySession.get(parentSessionId) ?? [])]))
    })

    return Service.of({ enqueue, drain, peek })
  }),
)

export const defaultLayer = layer

export * as PendingTaskNotifications from "./pending-notifications"
