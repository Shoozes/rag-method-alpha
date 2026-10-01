# Node Material

`NodeMaterial` is the core foundation for shader creation and material rendering in Three.js when using WebGPU and TSL.

It constructs a dynamic, modular node graph where every property—from diffuse colors and normal maps to physical properties and vertex displacement—is expressed as a composable TSL node.

<code name="nodeMaterialExample" default="true">NodeMaterial Showcase</code>

### How NodeMaterial Works

In Three.js WebGPU, standard material classes (`MeshStandardMaterial`, `MeshPhysicalMaterial`, `MeshBasicMaterial`, etc.) automatically inherit from or map to their `*NodeMaterial` counterparts (`MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, `MeshBasicNodeMaterial`, etc.).

This means you can assign TSL nodes directly to any material's `*Node` properties while retaining full compatibility with standard material properties (like `.roughness`, `.metalness`, and `.map`).

```js
import * as THREE from 'three';
import { color, sin, time, uv } from 'three/tsl';

// Works with both standard and explicit node material constructors
const material = new THREE.MeshStandardNodeMaterial();

// 1. Procedural color via colorNode
material.colorNode = color( 0x00aaff ).mul( sin( time ).mul( 0.5 ).add( 0.5 ) );

// 2. Dynamic roughness via roughnessNode
material.roughnessNode = uv().y;
material.metalness = 0.8;
```

### Node Material Inputs

`NodeMaterial` provides modular node slots (`*Node`) that control and override individual stages of the shader pipeline—including surface color, vertex displacement, lighting evaluation, shadows, and alpha testing:

::: api-class NodeMaterial [open]

::: api .colorNode : vec3 - Diffuse / base surface color. Overrides `color` and `map`. :::

::: api .positionNode : vec3 - Local vertex displacement before model-view transformation. :::

::: api .normalNode : vec3 - Surface normal direction in view space. Overrides `normalMap` and `bumpMap`. :::

::: api .opacityNode : float - Surface alpha / opacity value. Overrides `opacity` and `alphaMap`. :::

::: api .alphaTestNode : float - Threshold for discarding transparent fragments. :::

::: api .emissiveNode : vec3 - Emissive light color emitted by the surface. :::

::: api .envNode : vec3 - Custom environment reflections and PBR IBL lighting. :::

::: api .aoNode : float - Ambient occlusion influence on diffuse and ambient light. :::

::: api .outputNode : vec4 - Final output color composite, retaining lighting evaluation. :::

::: api .fragmentNode : vec4 - Complete override of the fragment shader stage. :::

::: api .vertexNode : vec4 - Complete override of the vertex shader stage. :::

::: api .depthNode : float - Custom fragment depth written to the depth buffer. :::

::: api .backdropNode : vec3 - Background texture sampled behind transparent surfaces. :::

::: api .backdropAlphaNode : float - Modulates the influence of `backdropNode` on outgoing light. :::

::: api .lightsNode : LightsNode - Selective lighting node restricting which scene lights illuminate the material. :::

::: api .castShadowNode : vec4 - Defines custom color and opacity for cast shadows. Requires `renderer.shadowMap.transmitted = true`. :::

::: api .receivedShadowNode : FunctionNode<vec4> - Custom shading logic or function `Fn( ( [ shadow ] ) => ... )` for received shadows. :::

::: api .castShadowPositionNode : vec3 - Overrides local vertex position used during shadow map depth projection. :::

::: api .receivedShadowPositionNode : vec3 - Overrides world position used when sampling received shadow maps. :::

::: api .maskNode : bool - Discards surface fragments if the mask evaluates to `false`. :::

::: api .maskShadowNode : bool - Alpha mask node applied during the shadow pass to discard shadow fragments. :::

:::

::: api-class MeshStandardNodeMaterial extends NodeMaterial [open]

::: api .roughnessNode : float - Surface roughness factor (smooth vs rough surface). :::

::: api .metalnessNode : float - Surface metalness factor (dielectric vs conductive metal). :::

:::

::: api-class MeshPhysicalNodeMaterial extends MeshStandardNodeMaterial

::: api .clearcoatNode : float - Clearcoat layer intensity. :::

::: api .clearcoatRoughnessNode : float - Clearcoat layer roughness factor. :::

::: api .clearcoatNormalNode : vec3 - Normal direction override for the clearcoat layer. :::

::: api .sheenNode : vec3 - Sheen layer tint color. :::

::: api .sheenRoughnessNode : float - Sheen layer roughness factor. :::

::: api .transmissionNode : float - Optical transmission factor through transparent media. :::

::: api .thicknessNode : float - Volume thickness for transmission and subsurface scattering. :::

::: api .iorNode : float - Index of Refraction (IOR) for physical reflections and refractions. :::

::: api .iridescenceNode : float - Thin-film iridescence layer intensity. :::

::: api .iridescenceIORNode : float - Index of refraction for the thin-film iridescence layer. :::

::: api .iridescenceThicknessNode : float - Physical thickness of the thin-film layer in nanometers. :::

::: api .specularColorNode : vec3 - Specular highlight tint color. :::

::: api .specularIntensityNode : float - Specular reflection intensity factor. :::

::: api .anisotropyNode : vec2 - Directional anisotropy vector for brushed metal surfaces. :::

::: api .dispersionNode : float - Chromatic dispersion (Abbe number) splitting light into spectral colors. :::

::: api .attenuationColorNode : vec3 - Medium absorption color for light traveling through the volume. :::

::: api .attenuationDistanceNode : float - Distance light must travel through the medium to reach attenuation color. :::

::: api-class MeshSSSNodeMaterial extends MeshPhysicalNodeMaterial

::: api .thicknessColorNode : vec3 - Subsurface scattering color node. Assigning a node enables the SSS lighting model. :::

::: api .thicknessDistortionNode : float - Normal distortion factor directing light around surface curvature. :::

::: api .thicknessAmbientNode : float - Minimum ambient subsurface light level scattered within the volume. :::

::: api .thicknessAttenuationNode : float - Distance attenuation factor for light traveling through the medium. :::

::: api .thicknessPowerNode : float - Exponent controlling the forward-scattering cone focus. :::

::: api .thicknessScaleNode : float - Multiplier scaling overall subsurface illumination intensity. :::

:::

::: api-class MeshPhongNodeMaterial extends NodeMaterial

::: api .specularNode : vec3 - Specular highlight color. :::

::: api .shininessNode : float - Shininess exponent controlling the sharpness of specular highlights. :::

:::

::: api-class PointsNodeMaterial extends NodeMaterial

::: api .sizeNode : float - Point size in pixels or world units. :::

:::

### Modifying vs Overriding Inputs

When you assign a node to a slot like `material.colorNode`, it completely replaces the default color calculation. If you instead want to **tint or modulate** the material's existing textures and properties, use **Material Accessor Nodes** (such as `materialColor`, `materialRoughness`, `materialNormal`):

```js
import { materialColor, materialRoughness, color, float } from 'three/tsl';

// Modulate the existing texture map by multiplying with a custom tint
material.colorNode = materialColor.mul( color( 0xff5500 ) );

// Scale existing roughness map values
material.roughnessNode = materialRoughness.mul( float( 0.5 ) );
```

See the [Material Inputs](#material-inputs) page for the full list of material accessor nodes and how they reactively evaluate textures, factors, and colors.

For **MRT (Multiple Render Targets)** and **Post-Processing**, it is recommended to use [Properties](#properties) (such as `diffuseColor`, `roughness`, `metalness`, `normalView`, `output`) instead, as they capture the internal evaluated variables computed during lighting execution.

> IA: In WebGPU, all standard Three.js materials are automatically node-ready and support `*Node` properties (such as `.colorNode`, `.roughnessNode`, `.positionNode`). When modifying existing material maps instead of replacing them, use accessor nodes like `materialColor` and `materialNormal`. For MRT attachments and post-processing passes, prefer using [Properties](#properties) (`diffuseColor`, `roughness`, `output`).

```tsl nodeMaterialExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { normalView, positionLocal, time, color, vec3, mix } from 'three/tsl';

// 1. Holographic spectral coordinates
const spectralCoord = normalView.z
	.mul( 3.0 )
	.add( positionLocal.y.mul( 5.0 ) )
	.add( time.mul( 0.6 ) );

// 2. Full-spectrum continuous rainbow
const rainbow = vec3(
	spectralCoord.cos(),
	spectralCoord.add( 2.094 ).cos(),
	spectralCoord.add( 4.188 ).cos()
).mul( 0.5 ).add( 0.5 );

// 3. Smooth transition from Cyber Blue to Full Rainbow spectrum
const cyberBlue = color( 0x00d4ff );
const colorCycle = time.mul( 0.5 ).sin().mul( 0.5 ).add( 0.5 );
const holoColor = mix( cyberBlue, rainbow, colorCycle );

// 4. Holographic scanlines & subtle projector flicker
const scanline = positionLocal.y.mul( 35.0 ).sub( time.mul( 2.5 ) ).sin().mul( 0.5 ).add( 0.5 );
const flicker = time.mul( 25.0 ).sin().mul( 0.03 ).add( 0.97 );

// 5. View-angle Fresnel glow
const fresnel = normalView.z.oneMinus().pow( 2.0 );

// 6. Composite glowing hologram beam
const holoBeam = holoColor.mul( scanline.mul( 0.5 ).add( 0.5 ) ).mul( flicker );

model.material.transparent = true;
model.material.side = THREE.DoubleSide;
model.material.colorNode = holoColor.mul( 0.2 );
model.material.emissiveNode = holoBeam.mul( fresnel.mul( 2.2 ).add( scanline.mul( 0.6 ) ) );
model.material.opacityNode = fresnel.mul( 0.7 ).add( scanline.mul( 0.2 ) ).add( 0.15 );
model.material.roughness = 0.1;
model.material.metalness = 0.8;
```
