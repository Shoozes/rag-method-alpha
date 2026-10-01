# Projector Light

TSL allows you to extend not only materials and post-processing, but also lighting.

`ProjectorLight` is a specialized light source that projects in a rectangular frustum (similar to a slide or video projector) instead of a standard circular cone.

### Extending Lights with `colorNode`

By assigning a TSL function to `light.colorNode`, you can project custom procedural patterns (such as animated water caustics, gobos, or textures) directly into the light beam. TSL automatically calculates the projected coordinates (`projectorUV`) and passes them into your shader function:

```js
const projectorLight = new THREE.ProjectorLight();
projectorLight.colorNode = Fn( ( [ projectorUV ] ) => {

	return projectorUV;

} );
```

In this example, a procedural caustics shader is pre-rendered once per frame using an offscreen `rtt` (Render-to-Texture) node for optimal performance, and then projected across the 3D scene.

<code name="projectorLightExample" default="true">Projector Light Example</code>

```tsl projectorLightExample
import 'scenes/empty';
import * as THREE from 'three';
import { Fn, color, vec3, mat3, float, time, min, length, smoothstep, mx_noise_float, rtt, uv } from 'three/tsl';

// Reference: https://www.shadertoy.com/view/3tlfR7 (adapted from David Hoskins)

const caustics = Fn( ( [ p, t ] ) => {

	const m = mat3(
		- 2.0, - 1.0, 2.0,
		3.0, - 2.0, 1.0,
		1.0, 2.0, 2.0
	);

	const n = mx_noise_float( p );
	const k = vec3( p, t );

	k.assign( k.mul( m ).mul( 0.5 ) );
	const l = length( float( 0.5 ).sub( k.add( n ).fract() ) );

	k.assign( k.mul( m ).mul( 0.4 ) );
	l.assign( min( l, length( float( 0.5 ).sub( k.add( n ).fract() ) ) ) );

	k.assign( k.mul( m ).mul( 0.3 ) );
	l.assign( min( l, length( float( 0.5 ).sub( k.add( n ).fract() ) ) ) );

	return l.pow( 7.0 ).mul( 25.0 );

} );

// 1. In this example, a procedural caustics shader is pre-rendered once per frame using
// an offscreen rtt (Render-to-Texture) node for optimal performance, and then projected across the 3D scene.
const causticMap = rtt( caustics( uv().sub( 0.5 ).mul( 6.0 ), time.mul( 0.4 ) ), 512, 512 );

// 2. Procedural water caustics projection sampling from RTT map
const projectorPattern = Fn( ( [ projectorUV ] ) => {

	const uvCoord = projectorUV.xy;

	// Sample pre-rendered caustic texture
	const caustic = causticMap.sample( uvCoord );

	// Soft rectangular aperture edge mask (vignette)
	const edgeMask = smoothstep( 0.5, 0.42, uvCoord.sub( 0.5 ).abs().x ).mul( smoothstep( 0.5, 0.42, uvCoord.sub( 0.5 ).abs().y ) );

	// Cyan aquatic light palette
	const lightColor = color( 0x5abcd8 ).mul( caustic );

	return lightColor.mul( edgeMask );

} );

// 3. Add sample 3D geometry to catch the projection and cast shadows
const objectMaterial = new THREE.MeshStandardNodeMaterial( { roughness: 0.3, metalness: 0.1, color: 0xffffff } );

const torusKnot = new THREE.Mesh( new THREE.TorusKnotGeometry( 0.7, 0.25, 128, 32 ), objectMaterial );
torusKnot.position.set( 0, 1.2, 0 );
torusKnot.castShadow = true;
torusKnot.receiveShadow = true;
scene.add( torusKnot );

// 4. Create ProjectorLight with custom colorNode and shadows
const projectorLight = new THREE.ProjectorLight( 0xffffff, 500 );
projectorLight.position.set( 3, 5, 3 );
projectorLight.target.position.set( 0, 0.5, 0 );
projectorLight.angle = Math.PI / 5;
projectorLight.penumbra = 0.4;
projectorLight.decay = 1.5;
projectorLight.distance = 0;

// Assign the TSL procedural projection shader
projectorLight.colorNode = projectorPattern;

// Configure projector shadows
projectorLight.castShadow = true;
projectorLight.shadow.mapSize.set( 1024, 1024 );
projectorLight.shadow.camera.near = 0.5;
projectorLight.shadow.camera.far = 15;
projectorLight.shadow.bias = - 0.001;

scene.add( projectorLight );
scene.add( projectorLight.target );
```
