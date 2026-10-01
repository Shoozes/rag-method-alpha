import type { WebGLRenderer } from "three";

let webglSupportConfirmed = false;

export function hasWebGLSupport(): boolean {
  if (webglSupportConfirmed) return true;

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!context) return false;

    context.getExtension("WEBGL_lose_context")?.loseContext();
    webglSupportConfirmed = true;
    return true;
  } catch {
    return false;
  }
}

export function releaseWebGLRenderer(renderer: WebGLRenderer): void {
  try {
    renderer.dispose();
  } finally {
    renderer.forceContextLoss();
  }
}
