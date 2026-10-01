import { spawn } from "node:child_process";
import { packageBinary, MODULE_ROOT, cleanDirectory } from "./tool.mjs";

const typescript = await packageBinary("typescript", "bin/tsc");
const output = `${MODULE_ROOT}/.artifacts/tsc`;
await cleanDirectory(output);
const child = spawn(process.execPath, [typescript, "--project", `${MODULE_ROOT}/tsconfig.build.json`], { cwd: MODULE_ROOT, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
