import { existsSync } from "node:fs";
import { basename } from "node:path";

const SYSTEM_CHROMIUM_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const errorMessage = (error) => error instanceof Error ? error.message : String(error);

export function findSystemChromium(environmentVariable) {
  const configured = process.env[environmentVariable];
  const executablePath = [configured, ...SYSTEM_CHROMIUM_PATHS].find(candidate =>
    typeof candidate === "string" && candidate.length > 0 && existsSync(candidate));
  if (!executablePath) return null;
  return { executablePath, label: configured === executablePath ? `environment:${basename(executablePath)}` : `system:${basename(executablePath)}` };
}

export async function launchChromium(chromium, options, environmentVariable) {
  const software = process.env.LOCAL_BROWSER_SOFTWARE_WEBGL === "1";
  const launchOptions = { ...options, args: [ ...(options.args ?? []),
    ...(software ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-features=WebGPU"] : []) ] };
  const configured = process.env[environmentVariable];
  if (configured) {
    if (!existsSync(configured)) throw new Error(`${environmentVariable} does not identify an existing local Chromium executable`);
    return { browser: await chromium.launch({ ...launchOptions, executablePath: configured }),
      executable: `environment:${basename(configured)}${software ? ":software-webgl" : ""}` };
  }
  try {
    return { browser: await chromium.launch(launchOptions), executable: `playwright-bundled${software ? ":software-webgl" : ""}` };
  } catch (bundledError) {
    const fallback = findSystemChromium(environmentVariable);
    if (!fallback) throw new Error(`No prepared Chromium browser is available: ${errorMessage(bundledError)}`);
    try {
      return { browser: await chromium.launch({ ...launchOptions, executablePath: fallback.executablePath }),
        executable: `${fallback.label}${software ? ":software-webgl" : ""}` };
    } catch (fallbackError) {
      throw new Error(`Prepared Chromium and ${fallback.label} could not launch: ${errorMessage(fallbackError)}`);
    }
  }
}
