import { trim, trimBounds } from "./normalize.js";

export interface Section { readonly index: number; readonly start: number; readonly end: number; readonly heading: string; readonly heading_level: number; }

const HEADING = /^(#{1,6})[ \t]+(.+)$/u;

function heading(line: string): { title: string; level: number } | null {
  const match = HEADING.exec(line);
  if (!match) return null;
  const title = Array.from(trim(match[2]!)).join("");
  return title ? { title, level: match[1]!.length } : null;
}

export function sections(value: string, format: "markdown" | "text"): readonly Section[] {
  const scalars = Array.from(value);
  if (!scalars.length) return [];
  if (format === "text") return [{ index: 0, start: 0, end: scalars.length, heading: "Overview", heading_level: 0 }];
  const headings: Array<{ start: number; bodyStart: number; title: string; level: number }> = [];
  let lineStart = 0;
  while (lineStart <= scalars.length) {
    const lineEnd = scalars.indexOf("\n", lineStart) >= 0 ? scalars.indexOf("\n", lineStart) : scalars.length;
    const parsed = heading(scalars.slice(lineStart, lineEnd).join(""));
    if (parsed) headings.push({ start: lineStart, bodyStart: lineEnd < scalars.length ? lineEnd + 1 : lineEnd, title: parsed.title, level: parsed.level });
    if (lineEnd === scalars.length) break;
    lineStart = lineEnd + 1;
  }
  if (!headings.length) return [{ index: 0, start: 0, end: scalars.length, heading: "Overview", heading_level: 0 }];
  const result: Section[] = [];
  const [preambleStart, preambleEnd] = trimBounds(scalars, 0, headings[0]!.start);
  if (preambleStart < preambleEnd) result.push({ index: result.length, start: preambleStart, end: preambleEnd, heading: "Overview", heading_level: 0 });
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index]!;
    const end = index + 1 < headings.length ? headings[index + 1]!.start : scalars.length;
    const [bodyStart, bodyEnd] = trimBounds(scalars, current.bodyStart, end);
    if (bodyStart >= bodyEnd) continue;
    const [sectionStart, sectionEnd] = trimBounds(scalars, current.start, end);
    if (sectionStart < sectionEnd) result.push({ index: result.length, start: sectionStart, end: sectionEnd, heading: current.title, heading_level: current.level });
  }
  return result;
}
