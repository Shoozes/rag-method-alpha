# Output Color Transform

By default, **`RenderPipeline`** automatically applies tone mapping and color space transformation to `renderPipeline.outputNode` as the final step before presenting pixels to the screen framebuffer `outputColorTransform = true`.

However, in advanced post-processing setups, applying color transformation at the very end can be too late. Certain screen-space effects—such as **FXAA** (Fast Approximate Anti-Aliasing) or stylization filters—expect **sRGB** (display-referred) input rather than linear HDR values.

For such scenarios, set **`renderPipeline.outputColorTransform = false`** and use **`renderOutput()`** to explicitly apply tone mapping and color space conversion at the exact desired position in your effect chain.

### Automatic vs. Manual Color Transformation

| Output Color Transform | Description |
| :--- | :--- |
| `true` (Default) | `RenderPipeline` automatically wraps the final `outputNode` with `renderOutput( outputNode, toneMapping, outputColorSpace )` at the end of the pipeline. Ideal for standard rendering pipelines and linear-space post-processing effects (such as Bloom, Depth of Field, or Motion Blur). |
| `false` (Manual) | Disables automatic end-of-pipeline conversion. You must manually insert `renderOutput()` in the effect chain before any passes that require sRGB input (such as FXAA). |

<code name="outputColorTransform" default="true">Output Color Transform</code>

::: api renderPipeline.outputColorTransform : boolean - Controls whether default tone mapping and color space transformation are automatically applied to the pipeline's output node. Defaults to `true`. :::

::: api renderOutput( colorNode, toneMapping?, outputColorSpace? ) : RenderOutputNode - Applies tone mapping and color space transformation to a color node.
- **colorNode**: `Node` - The color or pass node to transform.
- **toneMapping**: `number` - (Optional) Tone mapping technique to apply. Defaults to the renderer's active tone mapping.
- **outputColorSpace**: `string` - (Optional) Target color space. Defaults to the renderer's active output color space (typically `SRGBColorSpace`).
:::

```js
import { pass, renderOutput } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

// 1. Disable automatic output color transform at the end of the pipeline
renderPipeline.outputColorTransform = false;

// 2. Render the scene pass
const scenePass = pass( scene, camera );

// 3. Manually convert from linear HDR to output color space (sRGB) with tone mapping
const outputPass = renderOutput( scenePass );

// 4. Compute FXAA in sRGB color space
const fxaaPass = fxaa( outputPass );

// 5. Assign to the pipeline output
renderPipeline.outputNode = fxaaPass;
```

```tsl outputColorTransform
import 'scenes/shaderball';
import { pass, renderOutput } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

// 1. Disable default automatic output color transformation
renderPipeline.outputColorTransform = false;

// 2. Create the 3D scene pass
const scenePass = pass( scene, camera );

// 3. Manually apply tone mapping and color space transformation (Linear -> sRGB)
const outputPass = renderOutput( scenePass );

// 4. Apply FXAA after color transformation (FXAA requires sRGB input)
const fxaaPass = fxaa( outputPass );

// 5. Output the anti-aliased image
renderPipeline.outputNode = fxaaPass;
```
