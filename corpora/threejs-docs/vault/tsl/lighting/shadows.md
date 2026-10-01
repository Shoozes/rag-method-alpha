# Shadows

In Three.js WebGPU and TSL, shadows are fully node-based and integrated into the material and lighting evaluation pipeline.

Beyond standard shadow mapping, [Node Material](#node-material) provides dedicated properties to fully customize shadow behavior: `material.castShadowNode` enables colored transmitted shadows, `material.receivedShadowNode` customizes attenuation and tinting on receiving surfaces, while `material.castShadowPositionNode` and `material.receivedShadowPositionNode` allow overriding vertex positions during shadow map generation and sampling.

<code name="castShadowNode" default="true">Cast Shadow Node</code>
<code name="displacedShadowPosition">Displaced Shadow Position</code>

::: api shadow( light: Light, shadow?: LightShadow ) : ShadowNode - Creates a shadow node for directional or spot lights.
- **light**: `Light` - The shadow casting light.
- **shadow**: `LightShadow` - (Optional) The light shadow instance. Defaults to `light.shadow`.
:::

::: api pointShadow( light: PointLight, shadow?: LightShadow ) : PointShadowNode - Creates an omnidirectional point shadow node.
- **light**: `PointLight` - The shadow casting point light.
- **shadow**: `LightShadow` - (Optional) The point light shadow instance.
:::

`shadowPositionWorld` represents the world-space position evaluated when sampling shadow maps. It defaults to `positionWorld`, but can be overridden per-material via `receivedShadowPositionNode` or inside custom shading contexts (e.g. volumetric raymarching) via `context.shadowPositionWorld`:

::: api shadowPositionWorld : vec3 - Accessor representing the world-space position evaluated during shadow map sampling and shadow passes. :::

```tsl castShadowNode
import 'scenes/plane';
import * as THREE from 'three';
import { texture, vec4 } from 'three/tsl';

// 1. Enable transmitted shadow maps on the renderer for colored translucent shadows
renderer.shadowMap.transmitted = true;

// 2. Add key spotlight with shadows
const spotLight = new THREE.SpotLight( 0xffffff, 250, 30, Math.PI / 4, 0.5, 2.0 );
spotLight.position.set( - 3, 6, 3 );
spotLight.target.position.set( 0, 0, 0 );
spotLight.castShadow = true;
spotLight.shadow.mapSize.set( 2048, 2048 );
spotLight.shadow.camera.near = 1;
spotLight.shadow.camera.far = 15;
spotLight.shadow.bias = - 0.001;
scene.add( spotLight );
scene.add( spotLight.target );

// 3. Load color map texture
const colorMap = new THREE.TextureLoader().load( '../examples/textures/colors.png' );
colorMap.wrapS = colorMap.wrapT = THREE.RepeatWrapping;
colorMap.colorSpace = THREE.SRGBColorSpace;

// 4. Configure plane material and enable shadow casting
plane.material = new THREE.MeshStandardNodeMaterial( {
	map: colorMap,
	roughness: 0.0,
	metalness: 0.0,
	side: THREE.DoubleSide,
	transparent: true,
	opacity: .2
} );
plane.castShadow = true;
plane.rotation.x = - Math.PI / 4;

// 5. Cast translucent colored shadow matching the texture
plane.material.castShadowNode = vec4( texture( colorMap ).rgb, 0.8 );

// 6. Mark floor material to recompile and receive shadows from the new light
floor.material.needsUpdate = true;
```

```tsl displacedShadowPosition
import 'scenes/shaderball';
import { Fn, positionLocal, normalLocal, sin, time, color } from 'three/tsl';

// 1. Procedural vertex displacement wave
const displacement = Fn( () => {

	const wave = sin( positionLocal.y.mul( 6.0 ).add( time.mul( 4.0 ) ) ).mul( 0.15 );
	return normalLocal.mul( wave );

} );

// 2. Apply displacement just to shadow map generation
const offset = displacement();

model.material.castShadowPositionNode = positionLocal.add( offset );

model.material.colorNode = color( 0x00ffaa );
model.material.roughness = 0.3;
model.material.metalness = 0.2;
```
