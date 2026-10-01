# Properties

Properties serve as reference nodes in the shader graph. They can be created and accessed at any point during shader construction to assign or retrieve values dynamically.

In addition to custom properties, TSL provides built-in material properties that represent internal variables evaluated across the lighting and material pipeline.

<code name="propertyExample" default="true">Property example</code>

::: api property( type, name?, placeholderNode? ) : PropertyNode - Declares a reference property node in the shader scope.
- **type**: `string` - TSL type name (e.g. `'float'`, `'vec3'`, `'vec4'`).
- **name**: `string` - (Optional) Name of the property in the shader. Defaults to `null`.
- **placeholderNode**: `Node` - (Optional) Default fallback value node. Defaults to `null`.
:::

### Varying Property

The `varyingProperty()` function declares a varying property placeholder in the shader without initializing it immediately. This is useful when you need to write to the varying inside a custom TSL function.

<code name="varyingPropertyExample">Varying property example</code>

::: api varyingProperty( type, name?, placeholderNode? ) : PropertyNode - Declares a varying property placeholder for passing data from the vertex stage to the fragment stage.
- **type**: `string` - TSL type name (e.g. `'float'`, `'vec3'`, etc.).
- **name**: `string` - (Optional) Custom name for the varying variable. Defaults to `null`.
- **placeholderNode**: `Node` - (Optional) Default fallback value node. Defaults to `null`.
:::

### Built-in Material Properties

TSL includes pre-defined property nodes representing values computed during the material evaluation:

::: api output : vec4 - Final evaluated color output of the fragment shader. :::

::: api diffuseColor : vec4 - Base diffuse (albedo) color and opacity. :::

::: api roughness : float - Surface roughness factor. :::

::: api metalness : float - Surface metalness factor. :::

::: api emissive : vec3 - Emissive radiance color. :::

::: api specularColor : color - Specular reflection tint color. :::

::: api clearcoat : float - Clearcoat layer intensity. :::

::: api clearcoatRoughness : float - Clearcoat surface roughness. :::

::: api sheen : vec3 - Sheen color tint. :::

::: api sheenRoughness : float - Sheen roughness. :::

::: api iridescence : float - Iridescence intensity. :::

::: api transmission : float - Optical transmission (refraction) factor. :::

::: api thickness : float - Volume thickness for subsurface scattering and transmission. :::

::: api ior : float - Index of refraction. :::

::: api ambientOcclusion : float - Ambient occlusion factor (defaults to `1.0`). :::

### Using Properties with MRT

Built-in material properties are particularly powerful when combined with [MRT](#mrt) (Multiple Render Targets). Because properties like `output`, `diffuseColor`, `roughness`, `metalness`, and `emissive` are computed during material lighting execution, they can be captured directly into G-Buffer texture attachments for deferred rendering, post-processing effects (such as SSAO, SSR, SSGI, and Bloom), or custom compositing passes:

```js
import { mrt, output, diffuseColor, roughness, metalness, normalView } from 'three/tsl';

// G-Buffer pass: route material properties into dedicated render target textures
scenePass.setMRT( mrt( {
	output: output,
	albedo: diffuseColor.rgb,
	normal: normalView,
	roughness: roughness,
	metalness: metalness
} ) );
```

See the [MRT](#mrt) page for a complete guide on configuring and reading multi-target render passes.

```tsl propertyExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { diffuseColor, grayscale } from 'three/tsl';

// 1. Load texture and set it on the material map
const map = new THREE.TextureLoader().load( '../examples/textures/uv_grid_opengl.jpg' );
model.material.map = map;

// 2. Read diffuseColor property and convert it to grayscale on outputNode
model.material.outputNode = grayscale( diffuseColor );
```

```tsl varyingPropertyExample
import 'scenes/shaderball';
import { Fn, varyingProperty, positionLocal, vertexStage, time, vec3 } from 'three/tsl';

// Declare a varying property placeholder
const myVarying = varyingProperty( 'vec3', 'vCustomColor' );

const mainVertex = Fn( () => {

	// Animate/offset position in the vertex stage
	const offsetPosition = positionLocal.add( vec3( 0, time.sin().mul( 0.2 ), 0 ) );

	// Assign the animated position to our varying property
	myVarying.assign( offsetPosition );

	return offsetPosition;

} );

// Link the vertex function to positionNode to execute it on the vertex stage
model.material.positionNode = vertexStage( mainVertex() );

// Read from the varying property in the fragment stage
model.material.colorNode = myVarying;
```
