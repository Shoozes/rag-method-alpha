# Viewport

Viewport nodes return values and textures representing the screen-space viewport area. They are relative to the active viewport region and support physical pixel units, enabling advanced screen-space effects like refraction, depth testing, and volumetric rendering.

<code name="refractionExample" default="true">Glass Refraction</code>
<code name="depthVolumeExample">Depth Refraction</code>
<code name="privateGlassExample">Private Glass</code>
<code name="invertExample">Invert Glass</code>

::: api viewport : vec4 - Returns the viewport dimension in physical pixel units. :::

::: api viewportUV : vec2 - Returns the normalized viewport coordinate. :::

::: api viewportCoordinate : vec2 - Returns the viewport coordinate in physical pixel units. :::

::: api viewportSize : vec2 - Returns the viewport size in physical pixel units. :::

### Texture

::: api viewportSharedTexture( uv?, level? ) - Accesses the screen framebuffer texture already rendered in the current scene, sharing a single texture instance across all calls for optimal performance while preserving render order.
- **uv**: `Node` - (Optional) Coordinate node used for sampling the shared viewport texture. Defaults to `screenUV`.
- **level**: `Node` - (Optional) Mipmap level node to sample from. Defaults to `null`.
:::

::: api viewportMipTexture( uv?, level?, framebufferTexture? ) - Returns a viewport texture with mipmap generation enabled for blurred or LOD screen-space effects.
- **uv**: `Node` - (Optional) Coordinate node used for sampling the viewport texture. Defaults to `screenUV`.
- **level**: `Node` - (Optional) Mipmap level node to sample from. Defaults to `null`.
- **framebufferTexture**: `FramebufferTexture` - (Optional) Custom framebuffer texture instance. Defaults to `null`.
:::

### Depth

::: api viewportLinearDepth : float - Returns the linear (orthographic) depth value of the current fragment. :::

::: api viewportDepthTexture( uv?, level? ) - Returns the depth texture of the current viewport for screen-space depth evaluation and volume effects.
- **uv**: `Node` - (Optional) Coordinate node used for sampling the depth texture. Defaults to `screenUV`.
- **level**: `Node` - (Optional) Mipmap level node to sample from. Defaults to `null`.
:::

### Utils

::: api viewportSafeUV( uv? ) - Generates depth-aware safe UV coordinates for screen-space refraction. Performs depth testing to prevent foreground objects located in front of the refractive surface from leaking into the refraction sample. Returns `vec2`.
- **uv**: `vec2` - (Optional) Refracted UV coordinate node to evaluate. Defaults to `screenUV`.
:::

```tsl refractionExample
import 'scenes/shaderball';
import { color, normalLocal, positionLocal, modelNormalMatrix, viewportUV, viewportSharedTexture, positionView, positionViewDirection } from 'three/tsl';

// 1. Isolate high-frequency surface details by subtracting
// the smooth base normal from the actual geometry normal
const smoothNormal = positionLocal.normalize();
const detailNormal = normalLocal.sub( smoothNormal );

// 2. Transform the detail normal to view-space
const detailNormalView = modelNormalMatrix.mul( detailNormal );

// 3. Calculate a refracted UV coordinate using only the details normal (scaled by camera distance)
const distance = positionView.negate().dot( positionViewDirection );
const refractedUV = viewportUV.add( detailNormalView.xy.mul( 0.4 ).div( distance ) );

// 4. Sample the background scene using the refracted UV
model.material.backdropNode = viewportSharedTexture( refractedUV ).mul( color( 0x7dd3fc ) );
model.material.transparent = true;
```

```tsl depthVolumeExample
import 'scenes/shaderball';
import { color, normalLocal, positionLocal, modelNormalMatrix, viewportUV, viewportSharedTexture, positionView, positionViewDirection, viewportLinearDepth, linearDepth, cameraNear, cameraFar } from 'three/tsl';
import { hashBlur } from 'three/addons/tsl/display/hashBlur.js';

// 1. Isolate high-frequency surface details by subtracting
// the smooth base normal from the actual geometry normal
const smoothNormal = positionLocal.normalize();
const detailNormal = normalLocal.sub( smoothNormal );

// 2. Transform the detail normal to view-space
const detailNormalView = modelNormalMatrix.mul( detailNormal );

// 3. Calculate a refracted UV coordinate using only the details normal (scaled by camera distance)
const distance = positionView.negate().dot( positionViewDirection );
const refractedUV = viewportUV.add( detailNormalView.xy.mul( 0.4 ).div( distance ) );

// 4. Calculate the distance (thickness) between the surface and the background in actual scene units
const thickness = viewportLinearDepth.sub( linearDepth() ).mul( cameraFar.sub( cameraNear ) );

// 5. Compute the blur amount based on depth (objects further behind look blurrier)
const blurAmount = thickness.mul( 0.025 ).clamp( 0.0, 0.12 );

// 6. Sample the background scene with hash-blur at the refracted coordinates
model.material.backdropNode = hashBlur( viewportSharedTexture( refractedUV ), blurAmount ).mul( color( 0x7dd3fc ) );
model.material.transparent = true;
```

```tsl privateGlassExample
import 'scenes/shaderball';
import { viewportSharedTexture, viewportUV, viewportSize, vec2 } from 'three/tsl';

// 1. Correct for screen aspect ratio to keep the mosaic cells perfectly square
const blocksY = 40.0;
const blocksX = viewportSize.x.div( viewportSize.y ).mul( blocksY );
const blocks = vec2( blocksX, blocksY );

// 2. Quantize the screen coordinates into a grid (pixelation effect)
const pixelGrid = viewportSharedTexture( viewportUV.mul( blocks ).floor().div( blocks ) );

// 3. Sample the standard texture at the quantized screen coordinates
model.material.colorNode = pixelGrid;
model.material.transparent = true;
```

```tsl invertExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { viewportSharedTexture } from 'three/tsl';

// Replace the material with a transparent NodeMaterial
model.material = new THREE.NodeMaterial();
model.material.colorNode = viewportSharedTexture().rgb.oneMinus();
model.material.transparent = true;
```
