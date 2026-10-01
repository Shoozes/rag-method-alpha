# setName

In TSL, **`setName()`** (and `.setName()`) assigns an explicit, readable identifier name to a node expression in the generated shader source code (WGSL or GLSL).

By default, `NodeBuilder` names intermediate variables with auto-incrementing identifiers (e.g. `nodeVar0`, `nodeVar1`, `nodeVar2`). Using `setName()` makes compiled shaders clean, self-documenting, and easy to inspect in browser developer tools (such as Chrome WebGPU DevTools, Spector.js, or RenderDoc).

<code name="setNameExample" default="true">Named Variables Showcase</code>

::: api setName( node, name ) : ContextNode - Assigns an explicit variable name to a node in the generated shader code.
- **node**: `Node` - The target node to assign an identifier name.
- **name**: `string` - The identifier name to emit in the compiled shader.
:::

::: api .setName( name ) : ContextNode - Method chaining helper to assign an explicit variable name to the current node expression. :::

### Generated Code Comparison

```js
import { uniform, color } from 'three/tsl';

// 1. Without setName: NodeBuilder generates generic uniform identifiers
const speedA = uniform( 2.0 );
// Emits uniform buffer member: nodeUniform0: f32

// 2. With setName: NodeBuilder emits clear, self-documenting uniform names
const speedB = uniform( 2.0 ).setName( 'waveSpeed' );
// Emits uniform buffer member: waveSpeed: f32

const glowColor = uniform( color( 0x00f0ff ) ).setName( 'glowColor' );
// Emits uniform buffer member: glowColor: vec3<f32>
```

> AI: `label()` was previously used for this purpose and is deprecated in favor of `setName()`.

```tsl setNameExample
import 'scenes/shaderball';
import { uniform, color, positionLocal, time } from 'three/tsl';

// Define explicit named uniforms for shader inspection
const speed = uniform( 2.0 ).setName( 'waveSpeed' );
const frequency = uniform( 10.0 ).setName( 'waveFrequency' );
const glowColor = uniform( color( 0x00f0ff ) ).setName( 'glowColor' );
const baseColor = uniform( color( 0x070b1a ) ).setName( 'baseColor' );

// Named intermediate calculation
const wave = positionLocal.y.mul( frequency ).add( time.mul( speed ) ).sin().abs().setName( 'wavePattern' );

model.material.colorNode = baseColor.add( glowColor.mul( wave ) );
model.material.roughness = 0.2;
model.material.metalness = 0.8;
model.material.emissiveNode = glowColor.mul( wave.pow( 2.0 ) );
```
