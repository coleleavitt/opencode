import { createContext, createEffect, createMemo, createSignal, Show, useContext, type ParentProps } from "solid-js"

export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
}) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)

      // Latch on first ready. A <Show when={init.ready}> that re-evaluates
      // would unmount/remount children if ready ever flips back to false (or
      // thrashes during a setStore cascade), detaching them from the owner
      // chain that carries opentui's RendererContext — surfaces as
      // "No renderer found" inside @opentui/solid's createElement.
      const [latched, setLatched] = createSignal(false)
      const isReady = createMemo(() => {
        const ready = (init as { ready?: unknown } | undefined)?.ready
        if (ready === undefined) return true
        if (typeof ready === "function") return Boolean((ready as () => unknown)())
        return Boolean(ready)
      })
      createEffect(() => {
        if (isReady()) setLatched(true)
      })

      return (
        <Show when={latched()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use() {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
  }
}
