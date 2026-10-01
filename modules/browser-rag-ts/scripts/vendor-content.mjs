import { gunzipSync } from "node:zlib";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

function field(header, offset, length) {
  return header.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/su, "");
}

export function graphArchiveFiles(archive) {
  const bytes = gunzipSync(archive, { maxOutputLength: 24 * 1024 * 1024 });
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const declaredChecksum = Number.parseInt(field(header, 148, 8).trim(), 8);
    const checksum = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    if (checksum !== declaredChecksum) throw new Error("graph tar header checksum is invalid");
    const prefix = field(header, 345, 155);
    const name = `${prefix ? prefix + "/" : ""}${field(header, 0, 100)}`;
    const sizeText = field(header, 124, 12).trim();
    if (!/^[0-7]+$/u.test(sizeText)) throw new Error("graph tar member size is invalid");
    const size = Number.parseInt(sizeText, 8);
    const type = field(header, 156, 1);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) throw new Error("graph tar member exceeds its archive boundary");
    if (!name.startsWith("package/") || name.includes("\\") || name.includes(":") || name.split("/").some((part) => part === "." || part === "..")) throw new Error("graph tar contains an unsafe member path");
    if (type !== "5") {
      if (type !== "0" && type !== "") throw new Error("graph tar contains a non-file member");
      const path = name.slice("package/".length);
      if (!path || files.has(path)) throw new Error("graph tar contains an empty or duplicate file path");
      files.set(path, bytes.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!files.size || !files.has("package.json") || !files.has("LICENSE")) throw new Error("graph archive is empty or lacks its package metadata/license");
  return files;
}

async function installedFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error("installed graph package contains a symlink");
    if (entry.isDirectory()) files.push(...await installedFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error("installed graph package contains a non-file entry");
  }
  return files.sort();
}

export async function verifyInstalledGraph(archive, installedRoot) {
  if ((await lstat(installedRoot)).isSymbolicLink()) throw new Error("installed graph root must be an ordinary directory");
  const expected = graphArchiveFiles(archive);
  const actual = await installedFiles(installedRoot);
  if (JSON.stringify(actual) !== JSON.stringify([...expected.keys()].sort())) throw new Error("installed graph file inventory differs from the pinned archive");
  for (const path of actual) {
    const value = await readFile(join(installedRoot, ...path.split("/")));
    if (!value.equals(expected.get(path))) throw new Error(`installed graph content differs from the pinned archive: ${path}`);
  }
  return actual.length;
}
