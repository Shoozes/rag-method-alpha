# GLSL

**OpenGL Shading Language (GLSL)** is the traditional shading language of WebGL and OpenGL. Three.js provides **`glslFn`** to integrate existing or legacy GLSL function code directly into your TSL node graphs.

Using `glslFn`, you can easily reuse shader code from previous WebGL projects, Shadertoy snippets, or community libraries, allowing seamless interoperability and gradual migration to the new node system.

### Defining GLSL Functions

To define a native GLSL function, pass a standard GLSL function string to `glslFn`. The function signature defines the input parameter names and types, as well as the return type.

::: api glslFn( code, includes? ) : FunctionNode - Creates a native GLSL shader function node from a GLSL function definition.
- **code**: `string` - The GLSL function source code.
- **includes**: `Array<FunctionNode>` - (Optional) Array of dependency GLSL function nodes included in the generated shader. Defaults to `[]`.
:::

```js
import { glslFn, positionLocal, time } from 'three/tsl';

// 1. Define a native GLSL function
const proceduralGLSL = glslFn( `
	vec3 proceduralPattern( vec3 pos, float t ) {

		float waves = sin( pos.x * 6.0 + t ) * cos( pos.y * 6.0 - t );
		float glow = sin( pos.z * 10.0 + t * 2.0 ) * 0.5 + 0.5;

		float r = sin( waves * 3.14159 ) * 0.5 + 0.5;
		float g = glow;
		float b = cos( waves * 3.14159 ) * 0.5 + 0.5;

		return vec3( r, g, b );

	}
` );

// 2. Call the function node with named parameters or positional arguments
material.colorNode = proceduralGLSL( { pos: positionLocal, t: time } );
```

### Passing Parameters

GLSL functions can be called either with an object containing keys matching the function parameter names, or with positional arguments:

```js
// Named parameters (recommended for clarity)
material.colorNode = proceduralGLSL( { pos: positionLocal, t: time } );

// Positional arguments
material.colorNode = proceduralGLSL( positionLocal, time );
```

### Automatic Stage Resolution

In traditional GLSL shaders, passing data from vertex to fragment stages required manual plumbing: defining attributes, calculating projections in the vertex shader, declaring `varying` variables, and assigning values across stages.

In TSL, **Vertex Stage** and **Fragment Stage** are resolved automatically by the nodes themselves (`NodeBuilder`). When you reference nodes such as `positionWorld`, `normalView`, or `uv()` inside a fragment property (like `material.colorNode`), TSL automatically determines what geometry data must be fetched, generates the vertex calculations, and transparently routes the interpolated varyings to the fragment stage without requiring manual transportation.

### GLSL to TSL Mapping

| Vertex (GLSL) | Fragment (GLSL) | TSL Equivalent |
| :--- | :--- | :--- |
| `gl_Position` | - | `modelViewProjection` |
| `position` | `vPosition` | `positionLocal` / `positionWorld` |
| `normal` | `vNormal` | `normalLocal` / `normalWorld` |
| `uv` | `vUv` | `uv()` |
| `attribute <type> name` | `varying <type> name` | `attribute( 'name' )` |
| `modelMatrix` | - | `modelWorldMatrix` |
| `modelViewMatrix` | - | `modelViewMatrix` |
| `projectionMatrix` | - | `cameraProjectionMatrix` |
| `normalMatrix` | - | `modelNormalMatrix` |
| `varying = ...` | `vName` | `varying( node )` / `.toVarying()` |
| `position + offset` | - | `material.positionNode` |
| - | `gl_FragColor` | `material.colorNode` |
| `uniform <type> name` | `uniform <type> name` | `uniform( value )` |
| `uniform float time` | `uniform float time` | `time` |
| - | `cameraPosition` | `cameraPosition` |
| - | `texture2D( map, uv )` | `texture( map, uv() )` |
| - | `discard;` | `Discard()` / `.discard()` |
| - | `dFdx()`, `dFdy()` | `dFdx()`, `dFdy()` |
