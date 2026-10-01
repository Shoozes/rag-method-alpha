# UV

TSL provides dedicated utility functions for transforming 2D UV texture coordinates, such as rotating around pivot centers and applying spherical lens distortion.

<code name="uvExample" default="true">UV Manipulation</code>

::: api rotateUV( uv, rotation, center? ) : vec2 - Rotates the given UV coordinates around a specified 2D center point.
- **uv**: `vec2` - The UV coordinates to rotate.
- **rotation**: `float` - The rotation angle defined in radians.
- **center**: `vec2` - (Optional) The pivot center of rotation. Defaults to `vec2( 0.5, 0.5 )`.
:::

::: api spherizeUV( uv, strength, center? ) : vec2 - Applies a spherical warping (fisheye / lens bulge) effect to the given UV coordinates.
- **uv**: `vec2` - The UV coordinates.
- **strength**: `float` - The strength and direction of the spherical warping effect.
- **center**: `vec2` - (Optional) The center point of the spherical distortion. Defaults to `vec2( 0.5, 0.5 )`.
:::

### Replace Default UV

`replaceDefaultUV()` creates a context that intercepts and overrides default UV coordinates for all textures within a material or node sub-graph.

<code name="replaceDefaultUVExample">Replace Default UV</code>

::: api replaceDefaultUV( callback, node = null ) : ContextNode - Replaces the default UV coordinates used in texture lookups across a material or sub-graph.
- **callback**: `Function(Node): Node<vec2> | Node<vec2>` - A callback receiving the texture node and returning the new UV coordinates, or a replacement UV node directly.
- **node**: `Node` - (Optional) An optional target node to which the context will be applied. Defaults to `null`.
:::

### Example

```js
import { rotateUV, replaceDefaultUV, materialColor, uv, time, vec2 } from 'three/tsl';

// 1. Assign standard texture map
material.map = myTexture;

// 2. Override default UV coordinates for materialColor
material.colorNode = replaceDefaultUV( rotateUV( uv(), time, vec2( 0.5 ) ), materialColor );
```

```tsl replaceDefaultUVExample
import 'scenes/plane';
import * as THREE from 'three';
import { uv, time, rotateUV, replaceDefaultUV, materialColor, vec2 } from 'three/tsl';

// Load texture map
const map = new THREE.TextureLoader().load( '../examples/textures/uv_grid_opengl.jpg' );
map.wrapS = THREE.RepeatWrapping;
map.wrapT = THREE.RepeatWrapping;

// 1. Assign texture map to the plane material
plane.material.map = map;

// 2. Continuous rotation angle
const angle = time.mul( 0.5 );

// 3. Override default UVs for materialColor
plane.material.colorNode = replaceDefaultUV( rotateUV( uv().mul( 2.0 ), angle, vec2( 0.5 ) ), materialColor );
```

```tsl uvExample
import 'scenes/plane';
import * as THREE from 'three';
import { uv, time, texture, rotateUV, spherizeUV, vec2 } from 'three/tsl';

// Load texture map
const map = new THREE.TextureLoader().load( '../examples/textures/uv_grid_opengl.jpg' );
map.wrapS = THREE.RepeatWrapping;
map.wrapT = THREE.RepeatWrapping;

// 1. Continuous rotation angle in radians
const angle = time.mul( 0.5 );

// 2. Dynamic pulsating spherical warp strength
const strength = time.mul( 2.0 ).sin().mul( 1.2 );

// 3. Rotate UV coordinates and apply spherical lens distortion
const transformedUV = spherizeUV( rotateUV( uv().mul( 2.0 ), angle, vec2( 0.5 ) ), strength, vec2( 0.5 ) );

// 4. Sample texture on the plane material
plane.material.colorNode = texture( map, transformedUV );
```
