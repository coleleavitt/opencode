import { createEffect, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js"
import { debounce, type Scheduled } from "@solid-primitives/scheduled"

/**
 * Accessor<number> that advances to a fresh `Date.now()` on a fixed
 * interval. Use as a dependency in `createMemo(on([..., now], ...))`
 * when the memo derives a relative-time string (e.g. "5m ago", "in 3s")
 * that must stay live across the visible lifetime of the component.
 *
 * opentui's reconciler doesn't poll wall-clock time on its own and
 * Solid memos don't auto-reevaluate without a dependency change, so a
 * memo that computes `Date.now() - timestamp` at build time freezes
 * until an unrelated dep changes. This hook supplies the missing tick.
 *
 * The interval is unref'd so a stray ticker doesn't keep the host
 * process alive after the TUI exits.
 */
export function createNowTick(intervalMs: number = 30_000): Accessor<number> {
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    timer.unref?.()
    onCleanup(() => clearInterval(timer))
  })
  return now
}

export function createDebouncedSignal<T>(value: T, ms: number): [Accessor<T>, Scheduled<[value: T]>] {
  const [get, set] = createSignal(value)
  return [get, debounce((v: T) => set(() => v), ms)]
}

export function createFadeIn(show: Accessor<boolean>, enabled: Accessor<boolean>) {
  const [alpha, setAlpha] = createSignal(show() ? 1 : 0)
  let revealed = show()

  createEffect(
    on([show, enabled], ([visible, animate]) => {
      if (!visible) {
        setAlpha(0)
        return
      }

      if (!animate || revealed) {
        revealed = true
        setAlpha(1)
        return
      }

      const start = performance.now()
      revealed = true
      setAlpha(0)

      const timer = setInterval(() => {
        const progress = Math.min((performance.now() - start) / 160, 1)
        setAlpha(progress * progress * (3 - 2 * progress))
        if (progress >= 1) clearInterval(timer)
      }, 16)

      onCleanup(() => clearInterval(timer))
    }),
  )

  return alpha
}
