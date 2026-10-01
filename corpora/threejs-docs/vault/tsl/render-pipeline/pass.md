# Pass

In TSL, **`pass( scene, camera, options )`** creates a `PassNode` that renders a scene from a given camera into an internal render target and returns its output as a TSL texture/expression.

This is the cornerstone of post-processing pipelines and compositing in WebGPU: it allows entire scenes to be rendered, manipulated with TSL math or effects (like blur, color grading, tone mapping, edge detection, vignette), and chained together using `RenderPipeline`.

<code name="postProcessing" default="true">Post-processing</code>

::: api pass( scene, camera, options? ) : PassNode - Creates a render pass node for a scene and camera.
- **scene**: `Scene` - The scene to render.
- **camera**: `Camera` - The camera to render from.
- **options**: `Object` - (Optional) Options for the internal render target (e.g. `minFilter`, `magFilter`, `type`, `depthBuffer`, `samples`).
:::

::: api depthPass( scene, camera, options? ) : PassNode - Creates a dedicated depth pass node that renders the depth buffer of the scene. :::

::: api pass.getTextureNode( name? ) : TextureNode - Returns the texture node for the primary output or named MRT attachment. :::

::: api pass.getDepthNode() : Node - Returns the non-linear depth node from the pass's depth buffer. :::

::: api pass.getLinearDepthNode() : Node - Returns the linear depth (normalized 0 to 1) from the pass's depth buffer. :::

::: api pass.getViewZNode() : Node - Returns the view-space Z depth node from the pass's depth buffer. :::

::: api pass.setResolutionScale( scale ) - Sets a multiplier for the pass resolution relative to the renderer size (e.g. `0.5` for half resolution). :::

```js
import { pass, screenUV, vec2 } from 'three/tsl';

// 1. Create a scene render pass
const scenePass = pass( scene, camera );

// 2. Manipulate the render pass output using TSL operations (e.g., Vignette effect)
const vignette = screenUV.distance( vec2( 0.5 ) ).mul( 1.5 ).oneMinus().clamp();
const finalOutput = scenePass.rgb.mul( vignette );

// 3. Assign the composited pass to the render pipeline
renderPipeline.outputNode = finalOutput;
```

```tsl postProcessing
import 'scenes/shaderball';
import { pass, screenUV, vec2 } from 'three/tsl';

// 1. Create a scene render pass
const scenePass = pass( scene, camera );

// 2. Create a smooth circular vignette effect
const distFromCenter = screenUV.distance( vec2( 0.5 ) );
const vignette = distFromCenter.mul( 1.4 ).oneMinus().clamp();

// 3. Apply color grading and vignette to the scene pass output
const postProcess = scenePass.rgb.mul( vignette );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = postProcess;
```
