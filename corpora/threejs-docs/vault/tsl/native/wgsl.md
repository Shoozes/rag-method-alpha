# WGSL

**WebGPU Shading Language (WGSL)** is the native shader programming language of WebGPU. While TSL enables writing node-based shaders using pure JavaScript, Three.js also provides **`wgslFn`** to integrate raw native WGSL code directly into your TSL graphs.

Native functions declared with `wgslFn` behave like standard TSL nodes: they accept TSL expressions as inputs, output typed values, and can be composed with other native functions or node materials.

<code name="wgslBasicExample" default="true">Basic WGSL</code>
<code name="wgslIncludesExample">WGSL with Includes</code>
<code name="wgslTextureExample">WGSL Texture Sampling</code>

### Defining WGSL Functions

To define a native WGSL function, pass a standard WGSL function string to `wgslFn`. The function signature defines the input parameter names and types, as well as the return type.

::: api wgslFn( code, includes? ) : FunctionNode - Creates a native WGSL shader function node from a WGSL function definition.
- **code**: `string` - The WGSL function source code.
- **includes**: `Array<FunctionNode>` - (Optional) Array of dependency WGSL function nodes included in the generated shader. Defaults to `[]`.
:::

```js
import { wgslFn, positionLocal, time } from 'three/tsl';

// 1. Define a native WGSL function
const proceduralPattern = wgslFn( `
	fn proceduralPattern( pos: vec3<f32>, t: f32 ) -> vec3<f32> {

		let waves = sin( pos.x * 6.0 + t ) * cos( pos.y * 6.0 - t );
		let glow = sin( pos.z * 10.0 + t * 2.0 ) * 0.5 + 0.5;

		let r = sin( waves * 3.14159 ) * 0.5 + 0.5;
		let g = glow;
		let b = cos( waves * 3.14159 ) * 0.5 + 0.5;

		return vec3<f32>( r, g, b );

	}
` );

// 2. Call the function node with named parameters or positional arguments
material.colorNode = proceduralPattern( { pos: positionLocal, t: time } );
```

### Passing Parameters

WGSL functions can be called either with an object containing keys matching the function parameter names, or with positional arguments:

```js
// Named parameters (recommended for clarity)
material.colorNode = proceduralPattern( { pos: positionLocal, t: time } );

// Positional arguments
material.colorNode = proceduralPattern( positionLocal, time );
```

### Why Modular Functions?

| Aspect | Modular Functions (`wgslFn` / TSL) | Monolithic Shader Files |
| :--- | :--- | :--- |
| **Composability & Integration** | Effortlessly connects with other TSL nodes, materials, post-processing passes, and ecosystem extensions (such as `tsl-textures` or TypeGPU) with flexible parameter exchange. | Rigid structure; difficult to interface with other components or reuse without manual string manipulation and global uniforms. |
| **Maintainability** | Isolated single-responsibility functions make debugging, unit testing, and refactoring math simple without cascading side effects. | Fragile; updating logic risks breaking unrelated shader parts and requires maintaining large complex files. |
| **Automatic Imports** | Dependencies, helper functions, structs, and uniform bindings are automatically resolved and injected into the shader on demand as needed. | Requires manually maintaining `#include` directives, forward declarations, struct definitions, and strict declaration order. |
| **Tree Shaking** | Only imported and referenced functions are bundled into the application. | The entire shader file is bundled even if most logic is unused. |
| **Encapsulation** | Isolated local scope and explicit parameters; no name collisions. | Shared global namespace; frequent variable and uniform collisions. |

```tsl wgslBasicExample
import 'scenes/shaderball';
import { wgslFn, positionLocal, time } from 'three/tsl';

// Define a native WGSL function
const proceduralPattern = wgslFn( `
	fn proceduralPattern( pos: vec3<f32>, t: f32 ) -> vec3<f32> {

		let waves = sin( pos.x * 6.0 + t ) * cos( pos.y * 6.0 - t );
		let glow = sin( pos.z * 10.0 + t * 2.0 ) * 0.5 + 0.5;

		let r = sin( waves * 3.14159 ) * 0.5 + 0.5;
		let g = glow;
		let b = cos( waves * 3.14159 ) * 0.5 + 0.5;

		return vec3<f32>( r, g, b );

	}
` );

// Assign to material colorNode
model.material.colorNode = proceduralPattern( { pos: positionLocal, t: time } );
```

```tsl wgslIncludesExample
import 'scenes/shaderball';
import { wgslFn, positionLocal, time, color } from 'three/tsl';

// 1. Helper WGSL function: luminance calculation
const luminanceWGSL = wgslFn( `
	fn calcLuminance( rgb: vec3<f32> ) -> f32 {

		let weights = vec3<f32>( 0.299, 0.587, 0.114 );

		return dot( rgb, weights );

	}
` );

// 2. Main WGSL function that includes and calls the helper function
const duotoneWGSL = wgslFn( `
	fn duotone( pos: vec3<f32>, t: f32, colorA: vec3<f32>, colorB: vec3<f32> ) -> vec3<f32> {

		let rawPattern = sin( pos * 4.0 + vec3<f32>( t ) ) * 0.5 + 0.5;
		let lum = calcLuminance( rawPattern );

		return mix( colorA, colorB, lum );

	}
`, [ luminanceWGSL ] );

// 3. Invoke with named arguments
model.material.colorNode = duotoneWGSL( {
	pos: positionLocal,
	t: time,
	colorA: color( 0x0055ff ),
	colorB: color( 0xffaa00 )
} );
```

```tsl wgslTextureExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { wgslFn, texture, uv, color } from 'three/tsl';

const map = new THREE.TextureLoader().load( '../examples/textures/uv_grid_opengl.jpg' );
map.wrapS = THREE.RepeatWrapping;
map.wrapT = THREE.RepeatWrapping;

// Native WGSL function receiving a texture and sampler
const sampleWGSL = wgslFn( `
	fn sampleAndTint( tex: texture_2d<f32>, texSampler: sampler, uvCoord: vec2<f32>, tintColor: vec3<f32> ) -> vec4<f32> {

		let sampled = textureSample( tex, texSampler, uvCoord * 2.0 );

		return vec4<f32>( sampled.rgb * tintColor, sampled.a );

	}
` );

const textureNode = texture( map );

model.material.colorNode = sampleWGSL( {
	tex: textureNode,
	texSampler: textureNode,
	uvCoord: uv(),
	tintColor: color( 0x00ff88 )
} );
```
