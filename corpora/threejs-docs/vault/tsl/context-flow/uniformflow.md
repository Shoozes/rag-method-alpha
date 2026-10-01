# uniformFlow

In modern graphics APIs like **WebGPU (WGSL)**, operations that rely on implicit screen-space derivatives (such as `fwidth()`, `dFdx()`, `dFdy()`, or mipmapped texture sampling) require execution within **Uniform Control Flow**.

On the GPU, derivatives are calculated by comparing values between adjacent 2×2 fragment pixels (quads). When calculations with derivatives are placed inside a divergent conditional branch (where adjacent pixels take different execution paths), neighboring quad threads become desynchronized, causing corrupted derivatives and visual artifacts along the boundary.

`uniformFlow( node )` (or `.uniformFlow()`) forces `NodeBuilder` to evaluate all expressions in the root uniform scope across all threads *before* selecting the result.

<code name="uniformFlowExample" default="true">Uniform Flow Showcase</code>

::: api uniformFlow( node ) : ContextNode - Enforces that all child node dependencies execute strictly within uniform control-flow paths.
- **node**: `Node` - The node whose dependencies must evaluate in uniform control flow.
:::

::: api .uniformFlow() : ContextNode - Method chaining helper to enforce uniform control-flow execution on the current node expression. :::

### Example

Conditionals compile into dynamic `if/else` branching (evaluated locally). When inside a `uniformFlow()`, the code uses native `select()`, executing both branches instead of only one.

```js
// 1. Without uniformFlow(): emits dynamic if/else branching
const resultA = select( condition, valueA, valueB );

// 2. With uniformFlow(): evaluates both branches uniformly before selecting
const resultB = select( condition, valueA, valueB ).uniformFlow();
```

> Important: Because `uniformFlow()` evaluates both branches unconditionally to maintain quad thread synchronization, it can impact performance if the branches involve heavy math or expensive texture lookups.

```tsl uniformFlowExample
import 'scenes/plane';
import { uv, time, select, fwidth, color, float, fract } from 'three/tsl';

// 1. Dynamic animated division boundary across the plane
const splitPos = time.mul( 0.4 ).sin().mul( 0.3 ).add( 0.5 );
const condition = uv().x.greaterThan( splitPos );

// 2. Anti-aliased procedural stripe pattern that relies on fwidth() derivatives
const stripePattern = ( scale ) => {

	const coord = uv().mul( scale );
	const f = fract( coord.x );
	const fw = fwidth( coord.x ); // Screen-space derivative across neighbor pixels in 2x2 quad
	return f.div( fw.mul( 100.0 ) ).clamp( 0.0, 1.0 );

};

const patternA = stripePattern( float( 10.0 ) );
const patternB = stripePattern( float( 25.0 ) );

const cyan = color( 0x00f0ff ).mul( patternA );
const magenta = color( 0xff0055 ).mul( patternB );

// 3. select() with uniformFlow():
// - WITH uniformFlow(): quad threads evaluate derivatives synchronously in uniform scope (clean boundary)
// - WITHOUT uniformFlow(): quad threads diverge across the split, corrupting the derivative along the boundary seam
const finalColor = select( condition, cyan, magenta ).uniformFlow();

// 4. Assign to plane material
plane.material.colorNode = finalColor.debug();
```
