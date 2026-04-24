import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createMemo, createSignal } from "solid-js"
import { Locale } from "@/util"
import { createNowTick } from "../util/signal"
import { useTheme } from "../context/theme"
import { useKeybind } from "../context/keybind"
import { usePromptStash, type StashEntry } from "./prompt/stash"

function getRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return Locale.datetime(timestamp)
}

function getStashPreview(input: string, maxLength: number = 50): string {
  const firstLine = input.split("\n")[0].trim()
  return Locale.truncate(firstLine, maxLength)
}

export function DialogStash(props: { onSelect: (entry: StashEntry) => void }) {
  const dialog = useDialog()
  const stash = usePromptStash()
  const { theme } = useTheme()
  const keybind = useKeybind()

  const [toDelete, setToDelete] = createSignal<number>()
  // getRelativeTime(...) computes `Date.now() - entry.timestamp`. Without
  // a live signal as a dep the memo only re-runs when stash.list() or
  // toDelete() change, and the dialog renders "5m ago" that never
  // advances to "6m ago". Tick once per minute — "just now" → "1m ago"
  // resolution is what the user actually notices.
  const now = createNowTick(60_000)

  const options = createMemo(() => {
    const entries = stash.list()
    now()
    // Show most recent first
    return entries
      .map((entry, index) => {
        const isDeleting = toDelete() === index
        const lineCount = (entry.input.match(/\n/g)?.length ?? 0) + 1
        return {
          title: isDeleting ? `Press ${keybind.print("stash_delete")} again to confirm` : getStashPreview(entry.input),
          bg: isDeleting ? theme.error : undefined,
          value: index,
          description: getRelativeTime(entry.timestamp),
          footer: lineCount > 1 ? `~${lineCount} lines` : undefined,
        }
      })
      .toReversed()
  })

  return (
    <DialogSelect
      title="Stash"
      options={options()}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        const entries = stash.list()
        const entry = entries[option.value]
        if (entry) {
          stash.remove(option.value)
          props.onSelect(entry)
        }
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.stash_delete?.[0],
          title: "delete",
          onTrigger: (option) => {
            if (toDelete() === option.value) {
              stash.remove(option.value)
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
      ]}
    />
  )
}
