#!/usr/bin/env bun

const file = Bun.argv[2]
if (!file) {
  console.error("usage: bun run script/heap-analyze.ts <path.heapsnapshot> [top=20]")
  process.exit(1)
}
const top = Number.parseInt(Bun.argv[3] ?? "20", 10)

type Snap = {
  snapshot: {
    meta: {
      node_fields: string[]
      node_types: string[][]
      edge_fields: string[]
      edge_types: string[][]
    }
    node_count: number
    edge_count: number
  }
  nodes: number[]
  edges: number[]
  strings: string[]
}

const raw = (await Bun.file(file).json()) as Snap
const meta = raw.snapshot.meta
const nf = meta.node_fields.length
const ef = meta.edge_fields.length
const nodeTypes = meta.node_types[0]
const edgeTypes = meta.edge_types[0]
const nodes = raw.nodes
const edges = raw.edges
const strings = raw.strings
const count = nodes.length / nf

type NodeSlot = { idx: number; type: string; name: string; size: number; edgeCount: number }

const hist: Record<string, { n: number; bytes: number }> = {}
const slots: NodeSlot[] = new Array(count)
for (let i = 0; i < count; i++) {
  const base = i * nf
  const t = nodeTypes[nodes[base]]
  const name = strings[nodes[base + 1]] ?? ""
  const size = nodes[base + 3]
  const ec = nodes[base + 4]
  slots[i] = { idx: i, type: t, name, size, edgeCount: ec }
  const h = hist[t] ?? { n: 0, bytes: 0 }
  h.n++
  h.bytes += size
  hist[t] = h
}

const inbound = new Int32Array(count)
let cursor = 0
for (let i = 0; i < count; i++) {
  const ec = slots[i].edgeCount
  for (let e = 0; e < ec; e++) {
    const ebase = cursor * ef
    const toBytes = edges[ebase + 2]
    inbound[toBytes / nf]++
    cursor++
  }
}

const byType = Object.entries(hist)
  .sort((a, b) => b[1].bytes - a[1].bytes)
  .map(([t, v]) => ({ type: t, count: v.n, mb: +(v.bytes / 1048576).toFixed(2) }))

const largest = slots
  .slice()
  .sort((a, b) => b.size - a.size)
  .slice(0, top)
  .map((s) => ({ type: s.type, name: s.name.slice(0, 120), kb: +(s.size / 1024).toFixed(2), inbound: inbound[s.idx] }))

const closures = slots.filter((s) => s.type === "closure")
const closureTop: Record<string, number> = {}
for (const c of closures) closureTop[c.name] = (closureTop[c.name] ?? 0) + 1
const topClosures = Object.entries(closureTop)
  .sort((a, b) => b[1] - a[1])
  .slice(0, top)
  .map(([name, n]) => ({ name: name || "<anonymous>", n }))

const topReferenced = slots
  .map((s) => ({ ...s, incoming: inbound[s.idx] }))
  .sort((a, b) => b.incoming - a.incoming)
  .slice(0, top)
  .map((s) => ({
    type: s.type,
    name: s.name.slice(0, 120),
    incoming: s.incoming,
    kb: +(s.size / 1024).toFixed(2),
  }))

const stringHist: Record<string, number> = {}
for (const s of strings) {
  if (!s) continue
  const key = s.length > 80 ? s.slice(0, 60) + "…" : s
  stringHist[key] = (stringHist[key] ?? 0) + 1
}
const topStrings = Object.entries(stringHist)
  .sort((a, b) => b[1] - a[1])
  .slice(0, top)
  .map(([s, n]) => ({ s, n }))

const totalMB = +(slots.reduce((s, n) => s + n.size, 0) / 1048576).toFixed(2)

console.log(
  JSON.stringify(
    {
      file,
      nodes: count,
      edges: raw.snapshot.edge_count,
      totalMB,
      strings: strings.length,
      byType,
      largest,
      closures: { total: closures.length, top: topClosures },
      topReferenced,
      topStrings,
      _legend: { types: nodeTypes, edges: edgeTypes },
    },
    null,
    2,
  ),
)
