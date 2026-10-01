# Material Inputs

Material input nodes provide reactive GPU access to the input channels and texture maps of the material currently rendering the object.

When referenced in a TSL graph, nodes like `materialColor`, `materialRoughness`, and `materialMetalness` automatically evaluate the inputs assigned to the material, combining base values with texture maps (e.g. `color * map`, `roughness * roughnessMap.g`).

<code name="materialInputsExample" default="true">Material Inputs</code>

### Surface Inputs

::: api materialColor : vec3 - Diffuse color of the material (composed via `color * map`). :::

::: api materialOpacity : float - Opacity of the material (composed via `opacity * alphaMap`). :::

::: api materialEmissive : vec3 - Emissive color (composed via `emissive * emissiveIntensity * emissiveMap`). :::

::: api materialNormal : vec3 - Surface normal direction (evaluated from `normalMap`, `bumpMap`, or `normalView`). :::

::: api materialRoughness : float - Roughness factor (composed via `roughness * roughnessMap.g`). :::

::: api materialMetalness : float - Metalness factor (composed via `metalness * metalnessMap.b`). :::

### Physical & Advanced Inputs

::: api materialSpecular : vec3 - Specular tint color of the material. :::

::: api materialSpecularIntensity : float - Specular intensity factor (composed via `specularIntensity * specularMap.a`). :::

::: api materialReflectivity : float - Surface reflectivity coefficient. :::

::: api materialClearcoat : float - Clearcoat layer intensity (composed via `clearcoat * clearcoatMap.r`). :::

::: api materialClearcoatRoughness : float - Clearcoat roughness factor (composed via `clearcoatRoughness * clearcoatRoughnessMap.r`). :::

::: api materialClearcoatNormal : vec3 - Normal direction of the clearcoat layer. :::

::: api materialSheen : vec3 - Sheen layer color (composed via `sheen * sheenColor * sheenColorMap`). :::

::: api materialSheenRoughness : float - Sheen roughness factor (composed via `sheenRoughness * sheenRoughnessMap.a`). :::

::: api materialTransmission : float - Transmission factor through transparent materials (composed via `transmission * transmissionMap.r`). :::

::: api materialThickness : float - Volume thickness for transmission and subsurface scattering (composed via `thickness * thicknessMap.g`). :::

::: api materialIOR : float - Index of Refraction (IOR). :::

::: api materialIridescence : float - Iridescence layer intensity. :::

::: api materialAnisotropy : vec2 - Anisotropy direction vector for directional and brushed surfaces. :::

::: api materialDispersion : float - Chromatic dispersion strength. :::

### Environment & Occlusion

::: api materialAO : float - Ambient occlusion value (composed via `aoMap.r - 1 * aoMapIntensity + 1`). :::

::: api materialLightMap : vec3 - Baked lightmap color (composed via `lightMapIntensity * lightMap.rgb`). :::

::: api materialEnvIntensity : float - Environment reflection intensity factor. :::

::: api materialEnvRotation : mat4 - Environment map rotation matrix. :::

### Material Reference

::: api materialReference( name, type, material? ) : MaterialReferenceNode - Creates a reactive node linked directly to a property on a material.
- **name**: `string` - Name of the property on the material (e.g. `'opacity'`, `'roughness'`, or a custom property).
- **type**: `string` - Uniform type used to represent the value (`'float'`, `'color'`, `'vec2'`, `'vec3'`, `'vec4'`).
- **material**: `Material | null` - (Optional) Target material. If `null`, dynamically tracks the material of the current rendered object.
:::

> Note: `materialReference()` creates a live link to any JavaScript material property: whenever `material[ name ]` is modified on the CPU, the GPU uniform updates automatically without triggering a shader recompilation.

```tsl materialInputsExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { materialColor, materialRoughness, materialMetalness, normalView, positionViewDirection, color, float } from 'three/tsl';

// 1. Configure base material inputs in JavaScript
model.material.color = new THREE.Color( 0x0a1e3f );
model.material.roughness = 0.35;
model.material.metalness = 0.85;

// 2. Access the material inputs inside TSL expressions
const baseColor = materialColor;
const baseRoughness = materialRoughness;
const baseMetalness = materialMetalness;

// 3. Compute dynamic Fresnel rim effect
const fresnel = normalView.dot( positionViewDirection ).oneMinus().pow( 3.0 );

// 4. Modulate color and roughness dynamically using material inputs
const glowColor = color( 0x00f0ff );
model.material.colorNode = fresnel.mix( baseColor, glowColor );
model.material.roughnessNode = fresnel.mix( baseRoughness, float( 0.05 ) );
model.material.metalnessNode = baseMetalness;
```
