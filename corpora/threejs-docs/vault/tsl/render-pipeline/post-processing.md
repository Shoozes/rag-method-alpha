# Post-Processing

TSL provides a suite of modular post-processing nodes to create screen-space effects, image processing passes, and anti-aliasing techniques in WebGPU.

Effects are encapsulated into reusable nodes from `three/addons/tsl/display/` that process render pass outputs `pass( scene, camera )` and can be seamlessly combined and assigned to `renderPipeline.outputNode`.

<code name="bloomExample" default="true">Bloom</code>
<code name="gaussianBlurExample">Gaussian Blur</code>
<code name="dofExample">Depth of Field</code>
<code name="filmExample">Film Grain</code>
<code name="dotScreenExample">Dot Screen</code>
<code name="rgbShiftExample">RGB Shift</code>
<code name="sobelExample">Sobel Edge Detection</code>
<code name="afterImageExample">After Image</code>
<code name="radialBlurExample">Radial Blur</code>

::: api bloom( node, strength?, radius?, threshold? ) : BloomNode - Creates a bloom glow effect extracting high-luminance areas.
- **node**: `Node` - Input texture or pass node.
- **strength**: `number` - (Optional) Strength / intensity multiplier of the bloom. Defaults to `1`.
- **radius**: `number` - (Optional) Bloom blur radius. Defaults to `0`.
- **threshold**: `number` - (Optional) Luminance threshold limit below which pixels do not glow. Defaults to `0`.
:::

::: api gaussianBlur( node, directionNode?, sigma?, options? ) : GaussianBlurNode - Applies a two-pass separable Gaussian blur filter.
- **node**: `Node` - Input texture or pass node.
- **directionNode**: `Node | vec2 | number` - (Optional) Direction vector or radius scale. Defaults to `null`.
- **sigma**: `number` - (Optional) Standard deviation kernel radius. Defaults to `4`.
- **options**: `Object` - (Optional) Configuration options (`premultipliedAlpha`, `resolutionScale`).
:::

::: api radialBlur( node, options? ) : Node - Applies a radial blur centered on the screen.
- **node**: `Node` - Input texture or pass node.
- **options**: `Object` - (Optional) Blur options (e.g. `center`, `samples`, `factor`).
:::

::: api hashBlur( node, blurAmount?, options? ) : Node - Applies a randomized stochastic hash blur to the input.
- **node**: `Node` - Input texture or pass node.
- **blurAmount**: `Node | number` - (Optional) Intensity of the blur. Defaults to `0.1`.
- **options**: `Object` - (Optional) Additional options.
:::

::: api bilateralBlur( node, options? ) : BilateralBlurNode - Applies an edge-preserving bilateral filter.
- **node**: `Node` - Input texture or pass node.
- **options**: `Object` - (Optional) Filter radius, spatial sigma, and range sigma.
:::

::: api boxBlur( node, options? ) : Node - Applies a fast box blur filter.
- **node**: `Node` - Input texture or pass node.
- **options**: `Object` - (Optional) Box blur options.
:::

::: api lensflare( node, params? ) : LensflareNode - Generates bloom-based anamorphic streaks and lens flares.
- **node**: `Node` - Input bloom or emissive texture.
- **params**: `Object` - (Optional) Lensflare parameters.
:::

::: api dof( node, viewZNode, focusDistance?, focalLength?, bokehScale? ) : DepthOfFieldNode - Creates a realistic bokeh Depth of Field lens blur.
- **node**: `Node` - Input color texture or pass node.
- **viewZNode**: `Node` - View-space Z depth buffer node (e.g. `pass.getViewZNode()`).
- **focusDistance**: `Node | number` - (Optional) Distance to the focal plane in world units. Defaults to `1`.
- **focalLength**: `Node | number` - (Optional) Lens focal depth range. Defaults to `1`.
- **bokehScale**: `Node | number` - (Optional) Bokeh blur disc size. Defaults to `1`.
:::

::: api chromaticAberration( node, strength?, center?, scale? ) : ChromaticAberrationNode - Simulates optical lens dispersion by offsetting color channels radially.
- **node**: `Node` - Input texture or pass node.
- **strength**: `Node | number` - (Optional) Chromatic separation strength. Defaults to `1.0`.
- **center**: `Node | vec2` - (Optional) Center coordinate of dispersion. Defaults to screen center `(0.5, 0.5)`.
- **scale**: `Node | number` - (Optional) Distortion scale factor. Defaults to `1.1`.
:::

::: api film( node, intensity?, uvNode? ) : FilmNode - Adds cinematic film grain noise.
- **node**: `Node` - Input color node or pass.
- **intensity**: `Node | number` - (Optional) Grain noise intensity factor. Defaults to `null` (full strength).
- **uvNode**: `Node` - (Optional) Custom or animated UV coordinates node. Defaults to screen `uv()`.
:::

::: api dotScreen( node, angle?, scale? ) : Node - Generates a halftone dot raster printing pattern.
- **node**: `Node` - Input color node.
- **angle**: `Node | number` - (Optional) Grid rotation angle in radians. Defaults to `1.57`.
- **scale**: `Node | number` - (Optional) Dot grid frequency. Defaults to `1.0`.
:::

::: api rgbShift( node, amount?, angle? ) : Node - Offsets red and blue channels along a directional vector.
- **node**: `Node` - Input color node.
- **amount**: `Node | number` - (Optional) Channel offset distance. Defaults to `0.005`.
- **angle**: `Node | number` - (Optional) Offset angle in radians. Defaults to `0.0`.
:::

::: api sobel( node ) : Node - Applies a 3x3 Sobel operator for gradient edge detection.
- **node**: `Node` - Input color or depth node (typically after tone mapping). Returns `vec3` grayscale edges.
:::

::: api sharpen( node, sharpness?, denoise? ) : SharpenNode - Enhances edge contrast and image sharpness.
- **node**: `Node` - Input texture or pass node.
- **sharpness**: `Node | number` - (Optional) Sharpness strength. Defaults to `0.5`.
- **denoise**: `Node | number` - (Optional) Denoising threshold to avoid amplifying noise. Defaults to `0.0`.
:::

::: api afterImage( node, damp? ) : AfterImageNode - Blends previous frames to produce persistent motion blur trails.
- **node**: `Node` - Input texture or pass node.
- **damp**: `Node | number` - (Optional) Trail persistence factor between 0 (no trail) and 1 (infinite trail). Defaults to `0.96`.
:::

::: api lut3D( node, lut, size?, intensity? ) : Node - Color grades the image using a 3D Color Lookup Table.
- **node**: `Node` - Input color node.
- **lut**: `Data3DTexture | Texture` - 3D LUT texture.
- **size**: `number` - (Optional) LUT resolution cube size (e.g. `64`). Defaults to `64`.
- **intensity**: `Node | number` - (Optional) Blend intensity. Defaults to `1.0`.
:::

::: api pixelationPass( scene, camera, pixelSize, normalEdgeStrength?, depthEdgeStrength? ) : PixelationPassNode - Renders a stylized pixelated pass with geometric edge outlines.
- **scene**: `Scene` - Scene to render.
- **camera**: `Camera` - Active camera.
- **pixelSize**: `number` - Pixelation block size.
- **normalEdgeStrength**: `number` - (Optional) Outline strength from normal buffer. Defaults to `0.3`.
- **depthEdgeStrength**: `number` - (Optional) Outline strength from depth buffer. Defaults to `0.4`.
:::

::: api transition( nodeA, nodeB, mixTextureNode, mixRatio, threshold?, useTexture? ) : Node - Transitions between two passes using a gradient wipe texture.
- **nodeA**: `Node` - Initial scene pass node.
- **nodeB**: `Node` - Destination scene pass node.
- **mixTextureNode**: `TextureNode` - Wipe / dissolve pattern texture.
- **mixRatio**: `Node | number` - Progress ratio (0 to 1).
- **threshold**: `Node | number` - (Optional) Edge softness threshold. Defaults to `0.1`.
- **useTexture**: `boolean` - (Optional) Whether to sample texture values. Defaults to `true`.
:::

::: api fxaa( node ) : FXAANode - Computes Fast Approximate Anti-Aliasing (FXAA) in sRGB display space.
- **node**: `Node` - Input sRGB color node (apply `renderOutput()` before FXAA).
:::

::: api smaa( node ) : SMAANode - Applies Subpixel Morphological Anti-Aliasing (SMAA) with subpixel pattern reconstruction.
- **node**: `Node` - Input linear scene pass node.
- **options**: `Object` - (Optional) Additional options.
:::

```tsl bloomExample
import 'scenes/shaderball';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// 1. Create a scene render pass
const scenePass = pass( scene, camera );

// 2. Apply Bloom effect to the scene pass and scale intensity
const bloomPass = bloom( scenePass ).mul( .2 );

// 3. Composite the bloom glow over the scene pass
// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = scenePass.add( bloomPass );
```

```tsl gaussianBlurExample
import 'scenes/shaderball';
import { pass } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

// 1. Render scene pass
const scenePass = pass( scene, camera );

// 2. Apply a two-pass Gaussian blur filter
const blurredPass = gaussianBlur( scenePass, 3 );

// 3. Assign blurred output to render pipeline
// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = blurredPass;
```

```tsl dofExample
import 'scenes/shaderball';
import { pass } from 'three/tsl';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

// 1. Render scene pass
const scenePass = pass( scene, camera );
const colorTexture = scenePass.getTextureNode();
const viewZTexture = scenePass.getViewZNode();

// 2. Apply Depth of Field bokeh blur focused on the central model
const focusDistance = 4.5;
const focalLength = 1.2;
const bokehScale = 2.5;

const dofPass = dof( colorTexture, viewZTexture, focusDistance, focalLength, bokehScale );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = dofPass;
```

```tsl filmExample
import 'scenes/shaderball';
import { pass } from 'three/tsl';
import { film } from 'three/addons/tsl/display/FilmNode.js';

// 1. Render scene pass
const scenePass = pass( scene, camera );

// 2. Apply cinematic film grain noise
const filmPass = film( scenePass );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = filmPass;
```

```tsl dotScreenExample
import 'scenes/shaderball';
import { pass } from 'three/tsl';
import { dotScreen } from 'three/addons/tsl/display/DotScreenNode.js';

// 1. Render scene pass
const scenePass = pass( scene, camera );

// 2. Apply halftone dot raster screen effect
const dotPass = dotScreen( scenePass, 1.57, 0.35 );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = dotPass;
```

```tsl rgbShiftExample
import 'scenes/shaderball';
import { pass } from 'three/tsl';
import { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js';

// 1. Render scene pass
const scenePass = pass( scene, camera );

// 2. Apply horizontal RGB channel displacement
const shiftedPass = rgbShift( scenePass, 0.006, 0.0 );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = shiftedPass;
```

```tsl sobelExample
import 'scenes/shaderball';
import { pass, renderOutput } from 'three/tsl';
import { sobel } from 'three/addons/tsl/display/SobelOperatorNode.js';

// 1. Render scene pass
const scenePass = pass( scene, camera );

// 2. Convert to display space before extracting edges
const outputPass = renderOutput( scenePass );

// 3. Extract edges using Sobel gradient operator
const edgePass = sobel( outputPass );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = edgePass;
```

```tsl afterImageExample
import 'scenes/shaderball';
import { pass } from 'three/tsl';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';

// 1. Render scene pass
const scenePass = pass( scene, camera );

// 2. Retain previous frames to produce an afterimage motion trail
const trailPass = afterImage( scenePass, 0.94 );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = trailPass;
```

```tsl radialBlurExample
import 'scenes/shaderball';
import { pass } from 'three/tsl';
import { radialBlur } from 'three/addons/tsl/display/radialBlur.js';

// 1. Render scene pass
const scenePass = pass( scene, camera );

// 2. Apply radial zoom blur expanding from screen center
const blurredPass = radialBlur( scenePass );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = blurredPass;
```
