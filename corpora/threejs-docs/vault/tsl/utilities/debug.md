# Debug

Debugging shader graphs involves inspecting intermediate mathematical values, checking variable generation, and analyzing compiled backend shader code (WGSL or GLSL).

TSL provides the built-in `debug()` utility for logging compilation state and isolating node expressions during the build process.

<code name="debugExample" default="true">Debug Node</code>

### Functions

::: api debug( node, callback? ) : DebugNode - Creates a debug node that logs the compiled shader code and highlights the current node expression during shader generation.
- **node**: `Node` - The node or expression to debug.
- **callback**: `Function` - (Optional) Custom callback function with signature `( builder, snippet ) => void`. If omitted, prints formatted shader code with surrounding context to the console.
:::

::: api .debug( callback? ) : DebugNode - Chainable method to attach debugging to any existing node or expression.
- **callback**: `Function` - (Optional) Custom callback function with signature `( builder, snippet ) => void`.
:::

### Code Inspection with `debug()`

When `.debug()` or `debug()` is attached to an expression, TSL intercepts shader generation during the build process:

1. It identifies the active shader stage (`vertex`, `fragment`, or `compute`).
2. It prints the generated shader flow lines up to that node in the console.
3. It clearly demarcates the current node's generated code snippet with `/* ... */ <snippet> /* ... */`.

```js
import { uv, sin, time, color } from 'three/tsl';

// Attach .debug() to inspect the generated code for the wave calculation
const wave = sin( uv().x.mul( 10.0 ).add( time ) ).debug();

material.colorNode = color( 0x00ffcc ).mul( wave );
```

#### Custom Callback

You can pass a custom callback to receive the active `NodeBuilder` instance and the generated snippet string:

```js
const node = uv().x.mul( 2.0 ).debug( ( builder, snippet ) => {

	console.log( `Stage: ${ builder.shaderStage }, Snippet: ${ snippet }` );

} );
```

```tsl debugExample
import 'scenes/shaderball';
import { uv, sin, time, color, float } from 'three/tsl';

// 1. Calculate an animated pulse wave
const wave = sin( uv().x.mul( 12.0 ).add( time.mul( 3.0 ) ) ).mul( 0.5 ).add( 0.5 );

// 2. Debug the wave calculation
// debug() or .debug() outputs the generated shader flow and highlights the node in the console below
const debuggedWave = wave.debug();

// 3. Apply color blending driven by the debugged wave
const colorBase = color( 0x050c1a );
const colorHighlight = color( 0x00f0ff );
const finalColor = colorBase.mix( colorHighlight, debuggedWave );

model.material.colorNode = finalColor;
model.material.roughness = float( 0.2 );
model.material.metalness = float( 0.85 );
```
