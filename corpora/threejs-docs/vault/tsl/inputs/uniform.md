# Uniform

Uniforms are useful to update values of variables like colors, lighting, or transformations without having to recreate the shader program. They are the true variables from a GPU.

<code name="uniformEventUpdate" default="true">Uniform material update example</code>
<code name="uniformInlineUpdate">Uniform inline update example</code>

::: api uniform( value, type? )
- **value**: `boolean | number | Color | Vector2 | Vector3 | Vector4 | Matrix3 | Matrix4` - Dynamic value to initialize the uniform with.
- **type**: `string` - (Optional) Explicit TSL type name (e.g. `'float'`, `'vec3'`, etc.). Defaults to `null`.
:::

It is also possible to create update events on `uniforms`, which can be defined by the user:

::: api .onObjectUpdate( callback: Function ) - It will be updated every time an object like `Mesh` is rendered with this `Node` in `Material`. :::

::: api .onRenderUpdate( callback: Function ) - It will be updated once per render, common and shared materials, fog, tone mapping, etc. :::

::: api .onFrameUpdate( callback: Function ) - It will be updated only once per frame, regardless of when `render-pass` the frame has, cases like `time` for example. :::

```tsl uniformEventUpdate
import 'scenes/shaderball';
import { uniform, Fn, OnMaterialUpdate } from 'three/tsl';

const main = Fn( () => {

	const ramp = uniform( 0 );

	OnMaterialUpdate( ( { time } ) => {

		// update uniform value
		ramp.value = Math.abs( Math.sin( time ) );

	} );

	return ramp;

} );

model.material.colorNode = main();
```

```tsl uniformInlineUpdate
import 'scenes/shaderball';
import { uniform, color } from 'three/tsl';

// Inline update using onFrameUpdate event
const ramp = uniform( 0 ).onFrameUpdate( ( { time } ) => time % 1.0 );

// Assign to colorNode
model.material.colorNode = ramp.mul( color( 0x1e90ff ) );
```
