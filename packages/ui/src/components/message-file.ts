import type { FilePart } from "@opencode-ai/sdk/v2"

export function attached(part: FilePart) {
  return part.url.startsWith("data:") || !!part.blob
}

export function src(part: FilePart) {
  if (part.blob) return `/blob/${part.blob}`
  return part.url
}

export function inline(part: FilePart) {
  if (attached(part)) return false
  return part.source?.text?.start !== undefined && part.source?.text?.end !== undefined
}

export function kind(part: FilePart) {
  return part.mime.startsWith("image/") ? "image" : "file"
}
