import { spawn } from "node:child_process";
import { packageBinary, MODULE_ROOT } from "./tool.mjs";

const binary = await packageBinary("vite", "bin/vite.js");
const child = spawn(process.execPath, [binary, ...process.argv.slice(2)], {
  cwd: MODULE_ROOT,
  stdio: "inherit",
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
