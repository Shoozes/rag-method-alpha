# RTT

**RTT** (Render-to-Texture) allows any TSL node expression or fragment graph to be rendered into an offscreen texture using an internal `RenderTarget` and full-screen `QuadMesh`.

The resulting `RTTNode` extends `TextureNode`, enabling the baked output to be sampled across materials, passed into multi-tap image filters (e.g. blurs, blooms, Sobel filters), downscaled for performance, or cached for static procedural generation.

<code name="proceduralTexture" default="true">Procedural Texture</code>

### Functions

::: api rtt( node, width?, height?, options? ) : RTTNode - Renders a TSL node into an internal render target texture.
- **node**: `Node` - The TSL node expression to render into a texture.
- **width**: `int` - (Optional) Fixed width in pixels. If `null`, the render target automatically resizes with the renderer. Defaults to `null`.
- **height**: `int` - (Optional) Fixed height in pixels. If `null`, the render target automatically resizes with the renderer. Defaults to `null`.
- **options**: `Object` - (Optional) Configuration options for the internal render target.
- **options.type**: `number` - (Optional) Texture data type (e.g. `HalfFloatType`, `UnsignedByteType`). Defaults to `HalfFloatType`.
- **options.autoUpdate**: `boolean` - (Optional) Whether the texture should automatically update on each render. Defaults to `true`.
- **options.resolutionScale**: `float` - (Optional) Resolution scaling factor relative to the drawing buffer size. Defaults to `1`.
- **options.wrapS**: `number` - (Optional) Horizontal wrapping mode (e.g. `RepeatWrapping`, `ClampToEdgeWrapping`).
- **options.wrapT**: `number` - (Optional) Vertical wrapping mode.
- **options.minFilter**: `number` - (Optional) Texture minification filter.
- **options.magFilter**: `number` - (Optional) Texture magnification filter.
- **options.generateMipmaps**: `boolean` - (Optional) Whether to generate mipmaps for the texture.
- **options.depthBuffer**: `boolean` - (Optional) Whether to allocate a depth buffer. Defaults to `true`.
:::

::: api convertToTexture( node, width?, height?, options? ) : TextureNode | RTTNode - Ensures a node is converted to a sampleable texture node.
- **node**: `Node` - The node to convert. If already a `TextureNode`, it is returned directly; if a `PassNode`, its texture node is extracted; otherwise, an `rtt()` node is created.
- **width**: `int` - (Optional) Fixed width in pixels. Defaults to `null`.
- **height**: `int` - (Optional) Fixed height in pixels. Defaults to `null`.
- **options**: `Object` - (Optional) Configuration options forwarded to `rtt()`.
:::

### Why RTT?

Evaluating heavy procedural math or noise functions directly inside a surface fragment shader means the GPU recalculates the entire equation for every single pixel on screen. **RTT turns any node graph into a reusable GPU texture**, unlocking significant rendering and performance advantages:

- **Compute Caching**: Complex procedural formulas, fractal noise, or math patterns are evaluated **once** onto a 2D texture, converting millions of per-pixel GPU calculations into lightweight texture lookups.

- **Multi-Tap Image Processing**: Spatial effects—such as **Gaussian Blur**, **Bloom**, **Sobel edge detection**, and screen distortions—require sampling neighboring texels at offset UVs. RTT allows any node expression to be sampled with discrete convolution kernels.

- **Static & On-Demand Baking**: Setting `autoUpdate = false` allows procedural textures to be rendered once at startup, yielding zero ongoing per-frame shader evaluation overhead.

- **Resolution Decoupling**: Costly effects and intermediate passes can be rendered at fractional resolutions (via `setResolutionScale( 0.5 )` or fixed dimensions) to significantly reduce GPU memory bandwidth and fill-rate demands.

```tsl proceduralTexture
import 'scenes/shaderball';
import * as THREE from 'three';
import { rtt, uv, time, color, sin, cos, checker } from 'three/tsl';

// 1. Create an animated procedural pattern node
const scaledUV = uv().mul( 10.0 );
const wave = sin( scaledUV.x.add( time.mul( 2.0 ) ) ).mul( cos( scaledUV.y.add( time.mul( 1.5 ) ) ) );
const pattern = checker( scaledUV ).mix( color( 0x0a192f ), color( 0x00ffcc ) ).add( wave.mul( 0.25 ) );

// 2. Render the procedural node to an offscreen texture (RTT)
const proceduralRTT = rtt( pattern, 512, 512, {
	wrapS: THREE.RepeatWrapping,
	wrapT: THREE.RepeatWrapping
} );

// 3. Sample the baked RTT texture across the model's material
model.material.colorNode = proceduralRTT.sample( uv().mul( 2.0 ) );
model.material.roughnessNode = proceduralRTT.r.mul( 0.6 ).add( 0.2 );
model.material.metalness = 0.8;
```
