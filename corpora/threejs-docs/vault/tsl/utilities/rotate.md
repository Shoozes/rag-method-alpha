# Rotate

Rotation functions allow you to rotate 2D coordinates or 3D positions/vectors. This is essential for spinning instances in particle systems, rotating UV coordinates for animated textures, or orienting meshes.

<code name="teapotEmitter" default="true">Teapot Emitter</code>

::: api rotate( position, rotation, order='XYZ' ) : Node - Applies a rotation to the given position or vector node.
- **position**: `vec2 | vec3` - The 2D or 3D vector to rotate.
- **rotation**: `float | vec3` - For 2D positions, a single float angle (in radians). For 3D positions, a Euler rotation vector containing rotation angles for the X, Y, and Z axes.
- **order**: `string` - The Euler rotation order (e.g. `'XYZ'`, `'YZX'`, `'ZXY'`, `'XZY'`, `'YXZ'`, `'ZYX'`). Only used for 3D rotation. Defaults to `'XYZ'`.
:::

::: api .rotate( rotation, order='XYZ' ) : Node - Method chaining helper to rotate the current position or vector node. :::

```tsl teapotEmitter
import 'scenes/empty';
import * as THREE from 'three';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';
import { time, color, vec3, vec4, mix, range, rotate, positionLocal, normalLocal } from 'three/tsl';

// Instantiate the instanced mesh geometry and material
const geometry = new TeapotGeometry( 0.25, 8 );
const material = new THREE.MeshStandardNodeMaterial();
material.roughness = 0.1;
material.metalness = 0.95;

const count = 300;

// Setup randomized properties per instance
const rand = range( vec4( 0.0, 0.4, 0.0, 0.0 ), vec4( 1.0, 0.9, 1.0, 1.0 ) );
const offset = rand.x;
const speed = rand.y;

// Lifetime tracking
const life = time.mul( speed ).add( offset ).fract();

// Fountain mechanics: teapots spout upwards and fall back down (parabolic arc)
const Y = life.mul( 6.0 ).sub( life.pow( 2.0 ).mul( 6.0 ) );
const horizontalSpread = life.mul( 3.0 );
const angle = offset.mul( Math.PI * 2.0 );
const X = angle.cos().mul( horizontalSpread );
const Z = angle.sin().mul( horizontalSpread );
const instancePosition = vec3( X, Y, Z );

// 3D rotation angles over time for each instance
const rotX = offset.mul( 10.0 ).add( time.mul( 1.8 ) );
const rotY = offset.mul( 20.0 ).add( time.mul( 2.5 ) );
const rotZ = offset.mul( 30.0 ).add( time.mul( 1.2 ) );
const instanceRotation = vec3( rotX, rotY, rotZ );

// Apply local rotation to positions and normals so shading remains correct
const rotatedPosition = rotate( positionLocal, instanceRotation );
const rotatedNormal = rotate( normalLocal, instanceRotation );

// Translate the rotated local vertices to the instanced fountain positions
material.positionNode = rotatedPosition.add( instancePosition );
material.normalNode = rotatedNormal;

// Shifting rainbow colors over instance index
material.colorNode = mix( color( 0x00aaff ), color( 0xff00bb ), offset );

const instancedMesh = new THREE.Mesh( geometry, material );
instancedMesh.count = count;
instancedMesh.castShadow = true;
instancedMesh.receiveShadow = true;
instancedMesh.frustumCulled = false;
scene.add( instancedMesh );

// Add a SpotLight to illuminate the teapot fountain and cast shadows
const spotLight = new THREE.SpotLight( 0xffffff, 1000.0, 25.0 );
spotLight.angle = Math.PI / 3.0;
spotLight.penumbra = 0.8;
spotLight.position.set( - 4, 5, 4 );
spotLight.castShadow = true;
scene.add( spotLight );

// Set camera perspective further back to capture the whole area and shadows
camera.position.set( 0, 3.0, 8.0 );
```
