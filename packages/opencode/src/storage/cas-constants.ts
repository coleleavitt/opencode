/** Parts larger than this threshold (in bytes) are externalized to the CAS blob store */
export const BLOB_THRESHOLD = 4096

/** Check if a part's content exceeds the blob externalization threshold */
export function isLargePart(content: string) {
  return new Blob([content]).size > BLOB_THRESHOLD
}

export * as CasConstants from "./cas-constants"
