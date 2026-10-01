# Packing

Packing and unpacking functions compress mathematical vectors, normals, and floating-point values into compact data formats and color spaces.

In modern rendering and deferred pipelines (MRT), packing reduces memory bandwidth and render target attachment count by packing high-dimensional data (such as normals and roughness) into standard 8-bit or 16-bit textures.

<code name="packingMRTExample" default="true">Cel-Shading Outline</code>

### Normal Vector Packing

::: api packNormalToRGB( node ) : vec3 - Packs a normalized 3D direction vector (in `[-1, 1]`) into an RGB color (in `[0, 1]`).
- **node**: `vec3` - The 3D normal or direction vector to pack.
:::

::: api unpackRGBToNormal( node ) : vec3 - Unpacks an RGB color (in `[0, 1]`) back into a normalized 3D direction vector (in `[-1, 1]`).
- **node**: `vec3` - The RGB color to unpack.
:::

::: api unpackNormal( xy ) : vec3 - Reconstructs a full 3D normal vector from 2D XY coordinates by projecting onto a hemisphere.
- **xy**: `vec2` - The X and Y coordinates in the `[-1, 1]` range.
:::

### Float & Vector Bit-Packing

::: api packSnorm2x16( value ) : uint - Packs two signed normalized floats into a single 32-bit unsigned integer. :::

::: api unpackSnorm2x16( value ) : vec2 - Unpacks a 32-bit unsigned integer into two signed normalized floats. :::

::: api packUnorm2x16( value ) : uint - Packs two unsigned normalized floats into a single 32-bit unsigned integer. :::

::: api unpackUnorm2x16( value ) : vec2 - Unpacks a 32-bit unsigned integer into two unsigned normalized floats. :::

::: api packHalf2x16( value ) : uint - Packs two 16-bit half-precision floats into a single 32-bit unsigned integer. :::

::: api unpackHalf2x16( value ) : vec2 - Unpacks a 32-bit unsigned integer into two 16-bit half-precision floats. :::

::: api packSnorm4x8( value ) : uint - Packs four signed 8-bit normalized floats into a 32-bit unsigned integer. :::

::: api unpackSnorm4x8( value ) : vec4 - Unpacks a 32-bit unsigned integer into four signed 8-bit normalized floats. :::

::: api packUnorm4x8( value ) : uint - Packs four unsigned 8-bit normalized floats into a 32-bit unsigned integer. :::

::: api unpackUnorm4x8( value ) : vec4 - Unpacks a 32-bit unsigned integer into four unsigned 8-bit normalized floats. :::

```tsl packingMRTExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { pass, mrt, output, normalView, packNormalToRGB, unpackRGBToNormal, screenUV, viewportSize, texture, color, vec2, vec4, float, max, abs, dot } from 'three/tsl';

// 1. Create a render pass that writes packed normals into an MRT G-Buffer
const scenePass = pass( scene, camera );

// Set the normal attachment texture type to 8-bit per channel (UnsignedByteType)
const normalTex = scenePass.getTexture( 'normal' );
normalTex.type = THREE.UnsignedByteType;

scenePass.setMRT( mrt( {
	output: output,
	normal: vec4( packNormalToRGB( normalView ), float( 1.0 ) )
} ) );

// 2. Retrieve the color and normal MRT attachments
const colorTexture = scenePass.getTextureNode( 'output' );
const normalTexture = texture( normalTex );

// 3. Sample the packed normal at the 4 cardinal neighboring pixels (Sobel kernel)
const px = vec2( 1.0 ).div( viewportSize ); // one texel size in UV space

const nC = unpackRGBToNormal( normalTexture.sample( screenUV ).rgb );
const nN = unpackRGBToNormal( normalTexture.sample( screenUV.add( vec2( 0, 1 ).mul( px ) ) ).rgb );
const nS = unpackRGBToNormal( normalTexture.sample( screenUV.add( vec2( 0, - 1 ).mul( px ) ) ).rgb );
const nE = unpackRGBToNormal( normalTexture.sample( screenUV.add( vec2( 1, 0 ).mul( px ) ) ).rgb );
const nW = unpackRGBToNormal( normalTexture.sample( screenUV.add( vec2( - 1, 0 ).mul( px ) ) ).rgb );

// 4. Detect normal discontinuities — large differences between neighbors signal edges
const edgeH = abs( dot( nC, nN ).oneMinus() ).add( abs( dot( nC, nS ).oneMinus() ) );
const edgeV = abs( dot( nC, nE ).oneMinus() ).add( abs( dot( nC, nW ).oneMinus() ) );
const edgeStrength = max( edgeH, edgeV ).clamp( 0.0, 1.0 );

// 5. Threshold the edge strength to create clean contour lines
const outlineThreshold = float( 0.15 );
const isEdge = edgeStrength.step( outlineThreshold ).oneMinus();

// 6. Apply cel-shading quantization to the base color inside the model
const brightness = colorTexture.r.add( colorTexture.g ).add( colorTexture.b ).div( 3.0 );
const celSteps = float( 4.0 );
const quantized = brightness.mul( celSteps ).floor().div( celSteps );
const celColor = colorTexture.mul( quantized.div( brightness.add( 0.001 ) ) );

// 7. Composite: draw black outline over cel-shaded color
const outlineColor = color( 0x000000 );
const finalOutput = celColor.mix( outlineColor, isEdge );

renderPipeline.outputNode = finalOutput;
```
