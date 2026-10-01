import { spawn } from "node:child_process";
import { MODULE_ROOT } from "./tool.mjs";

const commands = [["scripts/compile.mjs"], ["scripts/vite.mjs", "build"], ["scripts/check-worker-bundle.mjs"], ["scripts/stage-static-artifact.mjs"], ["scripts/check-static-dist.mjs"]];
for (const args of commands) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: MODULE_ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`build command failed (${code})`)));
  });
}
