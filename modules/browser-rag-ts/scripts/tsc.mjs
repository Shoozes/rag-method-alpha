import { spawn } from "node:child_process";
import { packageBinary, MODULE_ROOT } from "./tool.mjs";

const binary = await packageBinary("typescript", "bin/tsc");
const extra = process.argv.slice(2);
for (const project of ["tsconfig.core.json", "tsconfig.worker.json", "tsconfig.demo.json"]) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [binary, "--project", `${MODULE_ROOT}/${project}`, ...extra], { cwd: MODULE_ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`TypeScript check failed for ${project} (${code})`)));
  });
}
