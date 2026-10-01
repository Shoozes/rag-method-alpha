/** Visible query strings are tested against independent corpus relevance judgments. */
export const documentationPresets = Object.freeze([
  { id: "texture-loader", label: "Load textures asynchronously", query: "TextureLoader loadAsync", mode: "keyword_only", scopes: "browser:local", topK: 8, expand: true },
  { id: "responsive-canvas", label: "Keep a canvas responsive", query: "resize renderer canvas without stretching the scene", mode: "keyword_only", scopes: "browser:local", topK: 8, expand: true },
  { id: "dispose-resources", label: "Dispose GPU resources", query: "dispose geometries materials textures render targets", mode: "keyword_only", scopes: "browser:local", topK: 8, expand: true },
  { id: "tsl-functions", label: "Understand TSL functions", query: "TSL Fn functions reusable shader nodes", mode: "keyword_only", scopes: "browser:local", topK: 8, expand: true },
] as const);
