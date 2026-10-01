# Light Functions

TSL provides specialized accessor functions to query light transforms, matrices, view vectors, and shadow projection coordinates directly in shader graphs.

These functions return uniform nodes that update automatically when light objects move or rotate in the scene.

<code name="lightFunctionsExample" default="true">Light Functions</code>

::: api lightPosition( light: Light ) : vec3 - Returns a uniform node representing the light source's position in world space.
- **light**: `Light` - The light instance to access.
:::

::: api lightTargetPosition( light: Light ) : vec3 - Returns a uniform node for the target position of a directional or spot light in world space.
- **light**: `Light` - The light instance to access.
:::

::: api lightViewPosition( light: Light ) : vec3 - Returns a uniform node representing the light source's position in camera view space.
- **light**: `Light` - The light instance to access.
:::

::: api lightTargetDirection( light: Light ) : vec3 - Returns the normalized target direction vector of the light in camera view space.
- **light**: `Light` - The light instance to access.
:::

::: api lightShadowMatrix( light: Light ) : mat4 - Returns the shadow projection matrix uniform node for the specified light.
- **light**: `Light` - The light source whose shadow matrix to retrieve.
:::

::: api lightProjectionUV( light: Light, position: vec3 = null ) : vec3 - Computes projected UV coordinates from a light's shadow projection matrix for spotlights and projector effects.
- **light**: `Light` - The light source used for projection.
- **position**: `vec3` - (Optional) The world-space position to project. Defaults to `positionWorld`.
:::

```tsl lightFunctionsExample
import 'scenes/empty';
import * as THREE from 'three';
import { Fn, lightProjectionUV, color, time } from 'three/tsl';

// 1. Create a dynamic SpotLight in the empty scene
const spotLight = new THREE.SpotLight( 0xffffff, 80, 20, Math.PI / 4, 0.4 );
spotLight.position.set( 0, 5, 0 );
spotLight.target.position.set( 0, 0, 0 );
spotLight.castShadow = true;

scene.add( spotLight );
scene.add( spotLight.target );

// 2. Assign a procedural projected pattern to spotLight.colorNode using lightProjectionUV()
spotLight.colorNode = Fn( () => {

	const projUV = lightProjectionUV( spotLight );
	const dist = projUV.xy.sub( 0.5 ).length();
	const rings = dist.mul( 30.0 ).sub( time.mul( 3.0 ) ).sin().mul( 0.5 ).add( 0.5 );

	return color( 0x00d4ff ).mix( color( 0xff0066 ), rings );

} );

// 3. Add a central sphere mesh to receive the projected spotlight pattern
const geometry = new THREE.SphereGeometry( 0.8, 64, 64 );
const material = new THREE.MeshStandardNodeMaterial( { roughness: 0.2, metalness: 0.1 } );
const sphere = new THREE.Mesh( geometry, material );
sphere.position.set( 0, 1.2, 0 );
sphere.castShadow = true;
sphere.receiveShadow = true;
scene.add( sphere );
```

#### Related
- [Lights](#lights)
- [Shadows](#shadows)
- [Projector Light](#projector-light)
- [Position](#position)
- [Camera](#camera)
