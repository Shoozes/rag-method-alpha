import assert from "node:assert/strict";
import test from "node:test";
import { htmlToMarkdown, resolveVaultLink, rewriteVaultLinks } from "../../../../scripts/prepare_threejs_docs.mjs";

const commit = "1a1c86699f9c38d4bef1cf51652e5f0e0680d745";
const context = {
  includedPaths: new Set(["api/Object3D.md", "api/Texture.md", "manual/scenegraph.md", "manual/fundamentals.md"]),
  upstreamPaths: new Set(["manual/pages/setup.html", "manual/pages/lights.html", "manual/examples/threejs-responsive.js", "manual/resources/images/compressed-but-large-wood-texture.jpg", "src/renderers/common/Lighting.js", "src/renderers/common/UniformBuffer.js", "examples/jsm/gpgpu/BitonicSort.js"]),
};
const manual = { path: "manual/scenegraph.md", original_path: "manual/pages/scenegraph.html" };

test("empty upstream anchors remain invisible while meaningful source labels survive", () => {
  const source = '<html><title>Example</title><body><p><a href="geometry.html"></a><a href="Geometry"> </a></p><p><a href="setup.html">Setup</a></p></body></html>';
  const converted = htmlToMarkdown(source, "example.html").content;
  assert.equal(converted.includes("Geometry"), false);
  assert.equal(converted.includes("geometry.html"), false);
  assert.match(converted, /\[Setup\]\(setup\.md\)/u);
});

test("member references select the existing class page without inventing an anchor", () => {
  assert.deepEqual(resolveVaultLink("../api/Object3D.lookAt.md", manual, context), { href: "../api/Object3D.md", outsideVault: false });
  const converted = htmlToMarkdown('<html><title>Example</title><body><a href="/docs/#api/en/core/Object3D.lookAt"><code>Object3D.lookAt</code></a></body></html>', "scenegraph.html").content;
  assert.match(rewriteVaultLinks(converted, manual, context), /\[Object3D\.lookAt\]\(\.\.\/api\/Object3D\.md\)/u);
});

test("unbundled manual lessons become verified pinned upstream links with an explicit omission label", () => {
  const actual = rewriteVaultLinks("Read [setup](setup.md).\n", manual, context);
  assert.equal(actual, `Read [setup](https://github.com/mrdoob/three.js/blob/${commit}/manual/pages/setup.html) (upstream; outside the offline vault).\n`);
});

test("omitted public support files resolve to their actual upstream directories", () => {
  const js = resolveVaultLink("../examples/threejs-responsive.js", manual, context);
  const image = resolveVaultLink("resources/images/compressed-but-large-wood-texture.jpg", manual, context);
  assert.equal(js.href, `https://github.com/mrdoob/three.js/blob/${commit}/manual/examples/threejs-responsive.js`);
  assert.equal(image.href, `https://github.com/mrdoob/three.js/blob/${commit}/manual/resources/images/compressed-but-large-wood-texture.jpg`);
  assert.equal(js.outsideVault, true); assert.equal(image.outsideVault, true);
});

test("multiline link labels resolve without changing their visible source text", () => {
  const source = "[read the\nsetup lesson](setup.md) and [a large\nwood image](resources/images/compressed-but-large-wood-texture.jpg).\n";
  const result = rewriteVaultLinks(source, manual, context);
  assert.ok(result.includes(`[read the\nsetup lesson](https://github.com/mrdoob/three.js/blob/${commit}/manual/pages/setup.html)`));
  assert.ok(result.includes(`[a large\nwood image](https://github.com/mrdoob/three.js/blob/${commit}/manual/resources/images/compressed-but-large-wood-texture.jpg)`));
  assert.equal((result.match(/outside the offline vault/gu) ?? []).length, 2);
});

test("undocumented API citations resolve to verified public source rather than nonexistent generated pages", () => {
  const api = { path: "api/UniformsGroup.md", original_path: "docs/pages/UniformsGroup.html.md" };
  for (const [href, target] of [["UniformBuffer.md#buffer", "src/renderers/common/UniformBuffer.js"], ["Lighting.md#createNode", "src/renderers/common/Lighting.js"], ["BitonicSort.md", "examples/jsm/gpgpu/BitonicSort.js"]]) {
    const actual = resolveVaultLink(href, api, context);
    assert.deepEqual(actual, { href: `https://github.com/mrdoob/three.js/blob/${commit}/${target}`, outsideVault: true });
  }
});

test("included links and ordinary external citations retain their exact original syntax", () => {
  const source = "[Texture](../api/Texture.md#name), [local](fundamentals.md), [upstream](https://threejs.org/manual/).\n";
  assert.equal(rewriteVaultLinks(source, manual, context), source);
});

test("Markdown-shaped code is not rewritten and converted links are idempotent", () => {
  const source = "`[setup](setup.md)`\n```js\n[setup](setup.md)\n```\n[setup](setup.md)\n";
  const result = rewriteVaultLinks(source, manual, context);
  assert.ok(result.startsWith("`[setup](setup.md)`\n```js\n[setup](setup.md)\n```\n"));
  assert.equal((result.match(/outside the offline vault/gu) ?? []).length, 1);
  assert.equal(rewriteVaultLinks(result, manual, context), result);
});

test("an unverified missing destination cannot silently become a published link", () => {
  assert.throws(() => resolveVaultLink("unknown.md", manual, context), /no bundled or verified upstream target/u);
  const missingSource = { ...context, upstreamPaths: new Set() };
  assert.throws(() => resolveVaultLink("UniformBuffer.md", { path: "api/UniformsGroup.md", original_path: "docs/pages/UniformsGroup.html.md" }, missingSource), /no bundled or verified upstream target/u);
});
