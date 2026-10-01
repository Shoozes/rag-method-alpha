import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { packageBinary, MODULE_ROOT, cleanDirectory } from "./tool.mjs";

const typescript = await packageBinary("typescript", "bin/tsc");
const output = resolve(MODULE_ROOT, ".artifacts/test-dist");
await cleanDirectory(output);
await new Promise((resolvePromise, reject) => {
  const child = spawn(process.execPath, [typescript, "--project", resolve(MODULE_ROOT, "scripts/tsconfig.test.json")], {
    cwd: MODULE_ROOT,
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`TypeScript test compilation failed (${code})`)));
});

async function collect(path) {
  const values = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) values.push(...await collect(child));
    else if (entry.name.endsWith(".test.js")) values.push(child);
  }
  return values;
}

const filter = process.argv[2];
const allTests = await collect(join(output, "tests"));
const selected = filter ? allTests.filter((path) => relative(join(output, "tests"), path).toLowerCase().includes(filter.toLowerCase())) : allTests;
if (!selected.length) throw new Error(filter ? `No compiled tests matched '${filter}'` : "No compiled tests were found");
const child = spawn(process.execPath, ["--test", ...selected], { cwd: MODULE_ROOT, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
