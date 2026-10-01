export const RAG_GRAPH_PALETTE = Object.freeze({
  canvas: "#080807",
  link: "#514331",
  reference: "#9c7a48",
  chunk: "#8d816e",
  source: "#e8c991",
  folder: "#b78a50",
  hit: "#f0b979",
  selected: "#ffe6b6",
  focus: "#f1eadf",
});

export type RagGraphPaletteKey = keyof typeof RAG_GRAPH_PALETTE;

const RAG_GRAPH_FAMILY_COLORS = Object.freeze([
  "#f4c86a", // luminous gold
  "#ff8066", // ember coral
  "#5fd19a", // emerald
  "#ff6fa2", // electric rose
  "#a88cff", // ultraviolet
  "#55d6e8", // ion cyan
  "#f0a94a", // amber
  "#70a8ff", // cobalt light
  "#ff9d5c", // tangerine
  "#a9d86e", // lichen glow
  "#d97dff", // magenta crystal
  "#d5dfeb", // silver light
]);

function alphabetBand(value: string): string {
  const first = value.match(/[a-z]/iu)?.[0]?.toUpperCase() ?? "#";
  if (first < "E") return "A–D";
  if (first < "I") return "E–H";
  if (first < "M") return "I–L";
  if (first < "Q") return "M–P";
  if (first < "U") return "Q–T";
  return "U–Z";
}

export function graphFamilyKey(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  if (!parts.length) return "Collection";
  if (parts[0]?.toLowerCase() === "api") return `API ${alphabetBand(parts.at(-1) ?? "")}`;
  if (parts[0]?.toLowerCase() === "tsl") return `TSL ${parts[1] ?? "Guide"}`;
  if (parts[0]?.toLowerCase() === "manual") return "Manual";
  return parts[0]!;
}

export function graphFamilyColor(path: string): string {
  const family = graphFamilyKey(path);
  let hash = 2166136261;
  for (let index = 0; index < family.length; index += 1) {
    hash ^= family.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return RAG_GRAPH_FAMILY_COLORS[(hash >>> 0) % RAG_GRAPH_FAMILY_COLORS.length]!;
}

export function graphFamilyColorNumber(path: string): number {
  return Number.parseInt(graphFamilyColor(path).slice(1), 16);
}

export function graphColorNumber(key: RagGraphPaletteKey): number {
  return Number.parseInt(RAG_GRAPH_PALETTE[key].slice(1), 16);
}

export function applyRagGraphCssPalette(element: { readonly style: { setProperty(name: string, value: string): void } }): void {
  for (const [name, value] of Object.entries(RAG_GRAPH_PALETTE)) {
    element.style.setProperty(`--rag-graph-${name}`, value);
  }
}
