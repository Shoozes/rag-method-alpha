# Override Node

In TSL, **`overrideNode`** (and `overrideNodes`) provides a mechanism to dynamically intercept and substitute specific target nodes within a node sub-graph, material, or pass during compilation.

This acts as dynamic dependency injection for shaders, allowing you to replace fundamental inputs (such as `positionLocal`, `positionView`, `normalView`, or `positionViewDirection`) without modifying or duplicating existing node graphs.

<code name="overridePosition" default="true">Override position</code>

::: api overrideNode( targetNode, callbackOrNode ) : OverrideContextNode - Overrides a single target node during compilation within a contextual flow.
- **targetNode**: `Node` - The target node to intercept and replace.
- **callbackOrNode**: `Function | Node` - A callback `(builder) => Node` returning the replacement, or the replacement `Node` directly.
:::

::: api overrideNodes( overrides ) : OverrideContextNode - Overrides multiple target nodes simultaneously during compilation.
- **overrides**: `Array<[Node, Function | Node]> | Map<Node, Function | Node>` - Map or array of pairs mapping target nodes to their respective replacement callbacks or nodes.
:::

```js
// Override a single node
material.contextNode = overrideNode( positionLocal, () => positionLocal.add( vec3( 1, 0, 0 ) ) );

// Override multiple nodes
material.contextNode = overrideNodes( [
	[ positionView, customPositionView ],
	[ normalView, customNormalView ]
] );
```

::: api .overrideNode( targetNode, callbackOrNode ) : OverrideContextNode - Method chaining helper to override a single target node for a specific node expression. :::

::: api .overrideNodes( overrides ) : OverrideContextNode - Method chaining helper to override multiple target nodes for a specific node expression. :::

### Compilation Flow

When `OverrideContextNode` wraps a node expression, `NodeBuilder` intercepts references to the target node during compilation and evaluates the replacement node instead.

### Common Use Cases

#### 1. Material-Wide Input Substitution
Assigning an override to `material.contextNode` replaces the target node across all stages (vertex and fragment) of that material:

```js
// Displaces vertex positions and keeps fragment calculations in sync
material.contextNode = overrideNode( positionLocal, () => positionLocal.add( normalLocal.mul( wave ) ) );
```

#### 2. Deferred Rendering (G-Buffer Resolve)
In deferred rendering, standard lighting materials require view-space positions and normals. Instead of scene geometry, `overrideNodes()` redirects the material to sample G-Buffer MRT textures:

```js
// Resolve pass: standard lighting material evaluating from G-Buffer textures
resolveMaterial.contextNode = overrideNodes( [
	[ positionView, gBufferPositionView ],
	[ positionViewDirection, gBufferPositionView.negate().normalize() ],
	[ normalView, gBufferNormalView ]
] );
```

#### 3. Scoped Sub-Graph Substitution
Calling `.overrideNode()` on a specific node expression restricts the override strictly to that sub-tree:

<code name="subGraphOverride">Sub-graph override</code>

```js
// Base stripe sub-graph along the Y-axis (horizontal)
const stripe = positionLocal.y.mul( 14.0 ).sin().abs();

// Branch 1: Standard horizontal stripes
const branch1 = color( 0x00ffff ).mul( stripe ).isolate();

// Branch 2: Rotated 90° into vertical stripes via swizzling (.yxz)
const branch2 = color( 0xff8800 ).mul(
	stripe.overrideNode( positionLocal, () => positionLocal.yxz )
).isolate();

// Unify both branches into a cross-hatched grid
material.colorNode = branch1.add( branch2 );
```

> Note: To evaluate the exact same node multiple times under different contextual parameters in the same graph, use [.isolate()](#isolate) to prevent cache reuse.

```tsl overridePosition
import 'scenes/shaderball';
import { overrideNode, positionLocal, normalLocal, time, color } from 'three/tsl';

model.material.colorNode = color( 0x0077ff );
model.material.roughness = 0.5;
model.material.metalness = 0.0;

// Override positionLocal dynamically across the material context
model.material.contextNode = overrideNode( positionLocal, () => {

	// Safe to reference positionLocal inside the callback without infinite recursion
	const wave = positionLocal.y.mul( 10.0 ).add( time.mul( 3.0 ) ).sin().mul( 0.08 );

	return positionLocal.add( normalLocal.mul( wave ) );

} );
```

```tsl subGraphOverride
import 'scenes/shaderball';
import { color, positionLocal, time } from 'three/tsl';

// Base stripe pattern computed along the Y-axis (horizontal stripes)
const stripe = positionLocal.y.mul( 14.0 ).add( time.mul( 2.0 ) ).sin().abs();

// Branch 1: Evaluates stripe with standard positionLocal (Horizontal stripes)
const branch1 = color( 0x00ffff ).mul( stripe ).isolate();

// Branch 2: Swaps coordinates (.yxz) to rotate the pattern 90° into vertical stripes
const branch2 = color( 0xff8800 ).mul(
	stripe.overrideNode( positionLocal, () => positionLocal.yxz )
).isolate();

// Unify: Combines horizontal and vertical stripes into a glowing grid
model.material.colorNode = branch1.add( branch2 );
```
