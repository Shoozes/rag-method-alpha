# Uniform Groups

Uniform groups allow grouping multiple uniforms into a single Uniform Buffer Object (UBO) on the GPU. This improves performance by reducing the number of individual uniform transfers.

<code name="predefinedUniformGroupExample" default="true">Predefined group example</code>
<code name="customUniformGroupExample">Custom group example</code>

::: api uniform.setGroup( group ) - Assigns the uniform to a specific uniform group.
- **group**: `UniformGroupNode` - The uniform group node (e.g. `objectGroup`, `renderGroup`, `frameGroup` or a custom group).
:::

By default, all uniforms belong to the predefined `objectGroup` (updated once per object). However, you can create custom uniform groups to control exactly when groups of related values are updated and uploaded to the GPU as a single block of memory (Uniform Buffer Object).

::: api uniformGroup( name ) - Creates a custom uniform group.
- **name**: `string` - The group name.
:::

::: api sharedUniformGroup( name ) - Creates a shared custom uniform group.
- **name**: `string` - The group name.
:::

#### Predefined Groups

- **`objectGroup`**: (Default) Updated once per object. Good for uniforms that vary between meshes.
- **`renderGroup`**: Shared group updated once per render call. Used for uniforms like lights, view/projection matrices, fog settings, and camera properties.
- **`frameGroup`**: Shared group updated once per frame. Used for uniforms that update once per frame, like global time or frame IDs.

```tsl predefinedUniformGroupExample
import 'scenes/shaderball';
import { uniform, color, renderGroup } from 'three/tsl';

// Create a uniform in the renderGroup (updated once per render call)
const myTimer = uniform( 0 ).setGroup( renderGroup ).onRenderUpdate( ( { time } ) => time );

// Use the render-grouped uniform to animate the color
model.material.colorNode = myTimer.sin().mul( color( 0x1e90ff ) );
```

```tsl customUniformGroupExample
import 'scenes/shaderball';
import { uniform, color, uniformGroup, Fn, OnMaterialUpdate } from 'three/tsl';

// 1. Create a custom uniform group
const configGroup = uniformGroup( 'config' );

// 2. Create uniforms and associate them with the group
const intensity = uniform( 1.0 ).setGroup( configGroup );
const tintColor = uniform( color( 0x1e90ff ) ).setGroup( configGroup );

model.material.colorNode = Fn( () => {

	// 3. Update the values dynamically and flag the group for update
	OnMaterialUpdate( ( { time } ) => {

		intensity.value = Math.abs( Math.sin( time ) );
		configGroup.needsUpdate = true; // Marks the entire group (UBO) to be uploaded to the GPU

	} );

	return tintColor.mul( intensity );

} )();
```
