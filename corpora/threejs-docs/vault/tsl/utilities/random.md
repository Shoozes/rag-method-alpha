# Random

TSL provides utilities for generating pseudo-random values. These are useful for procedural generation, noise, and randomized instanced attributes (e.g., varying speed, size, or color across thousands of particle instances).

<code name="rangeExample" default="true">Instanced Range</code>
<code name="hashExample">Hash Grid</code>
<code name="fireParticles">Realistic Bonfire</code>

::: api range( min, max ) : Node - Generates a range `attribute` of values between min and max. Attribute randomization is useful when you want to randomize values between instances and not between pixels.
- **min**: `Node | number | Vector2 | Vector3 | Vector4 | Color` - The minimum value.
- **max**: `Node | number | Vector2 | Vector3 | Vector4 | Color` - The maximum value.
:::

::: api hash( seed ) : float - Generates a hash value in the range `[ 0, 1 ]` from the given seed.
- **seed**: `Node | float | int | uint` - The input value to generate the hash from.
:::

```tsl rangeExample
import 'scenes/empty';
import * as THREE from 'three';
import { time, color, vec3, range, positionLocal } from 'three/tsl';

// Instantiate 100 spheres using a standard Mesh with .count
const geometry = new THREE.SphereGeometry( 0.15, 16, 16 );
const material = new THREE.MeshStandardNodeMaterial();

const count = 100;

// Randomize positions along the X and Z axes per instance
const randomPosition = range( vec3( - 2.5, 0.0, - 2.5 ), vec3( 2.5, 0.0, 2.5 ) );

// Randomize animation speed and maximum bounce height per instance
const randomSpeed = range( 1.5, 4.0 );
const randomHeight = range( 0.5, 1.8 );

// Animate vertical position dynamically using the instance-specific speed and height (adding 0.15 radius offset to stay above floor)
const posY = time.mul( randomSpeed ).sin().add( 1.0 ).mul( randomHeight ).add( 0.15 );

// Apply position transformation
material.positionNode = positionLocal.add( randomPosition ).add( vec3( 0.0, posY, 0.0 ) );

// Randomize material colors between bright blue and pink per instance
const randomColor = range( color( 0x00aaff ), color( 0xff00bb ) );
material.colorNode = randomColor;

const instancedMesh = new THREE.Mesh( geometry, material );
instancedMesh.count = count;
instancedMesh.frustumCulled = false;
scene.add( instancedMesh );

// Add a light to illuminate the spheres
const dirLight = new THREE.DirectionalLight( 0xffffff, 2.0 );
dirLight.position.set( 5, 10, 5 );
scene.add( dirLight );

camera.position.set( 0, 4.0, 6.0 );
```

```tsl hashExample
import 'scenes/empty';
import { screenUV, floor, hash } from 'three/tsl';

// Divide the screen coordinates into a 16x16 grid of cells
const gridCoords = floor( screenUV.mul( 16.0 ) );

// Hash each cell's 2D coordinate to generate a pseudo-random value [0, 1] per cell
const randomVal = hash( gridCoords );

// Output the random value as a grayscale color
renderPipeline.outputNode = randomVal;
```

```tsl fireParticles
import 'scenes/empty';
import * as THREE from 'three';
import { range, time, uv, color, float, vec3, mix, smoothstep, mx_noise_float, vec4, spherizeUV, vec2, hash, instanceIndex } from 'three/tsl';
import { curlNoise } from 'three/addons/tsl/math/curlNoise.js';

// Particle count parameters grouped at the top of the code
const fireCount = 400;
const smokeCount = 700;
const sparkCount = 300;

// Global simulation speed multiplier constant
const simSpeed = 0.9;
const speedTime = time.mul( simSpeed );

// Fire Particle Emitter (Flame Core)
// Slower fire speed range
const fireRand = range( vec4( 0.0, 0.22, 0.0, 0.0 ), vec4( 1.0, 0.7, 1.0, 1.0 ) );
const fireOffset = fireRand.x;
const fireSpeed = fireRand.y;

// Map Z and W components of range() to a circular disk base of radius 0.35
const fireRadiusBase = fireRand.z.mul( 0.35 );
const fireAngleBase = fireRand.w.mul( Math.PI * 2.0 );
const fireBaseX = fireAngleBase.cos().mul( fireRadiusBase );
const fireBaseZ = fireAngleBase.sin().mul( fireRadiusBase );

const fireScale = range( 0.22, 0.42 );
const fireLife = speedTime.mul( fireSpeed ).add( fireOffset ).fract();

// Calculate fire position: starts narrow at base, then expands/funnels outwards as it rises and dissipates (upward cone)
const fireSpread = fireLife.mix( float( 0.5 ), float( 1.7 ), fireLife ); // starts narrow, expands outwards widely
const fireCurrentAngle = fireOffset.mul( Math.PI * 2.0 ).add( fireLife.mul( 1.5 ) );

// Add randomized dispersion offsets that grow with life to scatter particles as they rise
const fireScatterX = hash( instanceIndex.add( 11.0 ) ).sub( 0.5 ).mul( 0.8 ).mul( fireLife.pow( 1.5 ) );
const fireScatterZ = hash( instanceIndex.add( 22.0 ) ).sub( 0.5 ).mul( 0.8 ).mul( fireLife.pow( 1.5 ) );

const fireX = fireBaseX.mul( fireSpread ).add( fireScatterX ).add( fireCurrentAngle.cos().mul( 0.08 ).mul( fireLife ) );
const fireZ = fireBaseZ.mul( fireSpread ).add( fireScatterZ ).add( fireCurrentAngle.sin().mul( 0.08 ).mul( fireLife ) );
const fireY = range( 1.0, 1.5 ).mul( fireLife ); // lower upward rising height
const firePos = vec3( fireX, fireY, fireZ );

// Perturb UV coordinates with 3D noise for organic, fluid-like shapes
const fireNoiseInput = vec3( uv().x.mul( 2.5 ), uv().y.mul( 2.5 ).sub( fireLife.mul( 2.0 ) ), fireOffset.mul( 10.0 ) );
const fireNoiseOffset = mx_noise_float( fireNoiseInput ).mul( 0.15 );
const fireDist = uv().sub( 0.5 ).add( fireNoiseOffset ).length();
const fireShape = smoothstep( 0.5, 0.0, fireDist );
const firePuff = fireShape.clamp();

// Fire material setup using SpriteNodeMaterial
const fireMaterial = new THREE.SpriteNodeMaterial();
fireMaterial.positionNode = firePos;

// Grow quickly from the base, fade out slowly at the top
const fireScaleEnvelope = smoothstep( float( 0.0 ), float( 0.1 ), fireLife ).mul( fireLife.oneMinus().pow( 0.5 ) );
fireMaterial.scaleNode = fireScale.mul( fireScaleEnvelope );

fireMaterial.colorNode = mix( color( 0xffaa00 ), color( 0xff3b00 ), fireLife ); // gold to hot red-orange
fireMaterial.opacityNode = firePuff.mul( fireLife.oneMinus().pow( 4.0 ) ).mul( .5 ); // smoother fade out
fireMaterial.transparent = true;
fireMaterial.depthWrite = false;
fireMaterial.blending = THREE.AdditiveBlending;

const fireParticles = new THREE.Sprite( fireMaterial );
fireParticles.count = fireCount;
fireParticles.renderOrder = 2;
fireParticles.frustumCulled = false;
scene.add( fireParticles );

// Smoke Particle Emitter (Rising Ash)
// Slower smoke speed range
const smokeRand = range( vec4( 0.0, 0.12, 0.0, 0.0 ), vec4( 1.0, 0.26, 1.0, 1.0 ) );
const smokeOffset = smokeRand.x;
const smokeSpeed = smokeRand.y;

// Map Z and W to match the circular base area
const smokeRadiusBase = smokeRand.z.mul( 0.35 );
const smokeAngleBase = smokeRand.w.mul( Math.PI * 2.0 );
const smokeBaseX = smokeAngleBase.cos().mul( smokeRadiusBase );
const smokeBaseZ = smokeAngleBase.sin().mul( smokeRadiusBase );

const smokeScale = range( 0.35, 0.8 );
const smokeLife = speedTime.mul( smokeSpeed ).add( smokeOffset ).fract();

// Calculate smoke position: rises twisting upward, dispersing/expanding outwards as it rises
const smokeCurrentAngle = smokeOffset.mul( Math.PI * 2.0 );
const smokeSpread = smokeLife.mix( float( 0.4 ), float( 2.8 ), smokeLife ); // wider upward expansion

// Add randomized dispersion offsets that grow with life to scatter particles as they rise
const smokeScatterX = hash( instanceIndex.add( 33.0 ) ).sub( 0.5 ).mul( 1.5 ).mul( smokeLife.pow( 1.5 ) );
const smokeScatterZ = hash( instanceIndex.add( 44.0 ) ).sub( 0.5 ).mul( 1.5 ).mul( smokeLife.pow( 1.5 ) );

const smokeX = smokeBaseX.mul( smokeSpread ).add( smokeScatterX ).add( smokeCurrentAngle.cos().mul( 0.3 ).mul( smokeSpread ) );
const smokeZ = smokeBaseZ.mul( smokeSpread ).add( smokeScatterZ ).add( smokeCurrentAngle.sin().mul( 0.3 ).mul( smokeSpread ) );
const smokeY = mix( range( 0.0, 0.1 ), range( 2.4, 4.8 ), smokeLife ); // starts right at the floor level
const smokePos = vec3( smokeX, smokeY, smokeZ );

// Deform smoke shape with 3D noise for wispy, textured smoke clouds (perturbed UV method)
const smokeUv = spherizeUV( uv(), 4.0 ).mul( 0.95 ).add( 0.025 );
const smokeNoiseInput = vec3( smokeUv.x.mul( 3.0 ), smokeUv.y.mul( 3.0 ).sub( smokeLife.mul( 1.8 ) ), smokeOffset.mul( 20.0 ) );
const smokeNoiseOffset = mx_noise_float( smokeNoiseInput ).mul( 0.18 );
const smokeDist = smokeUv.sub( 0.5 ).add( smokeNoiseOffset ).length();
const smokeShape = smoothstep( 0.5, 0.15, smokeDist );
const smokePuff = smokeShape.clamp();

const smokeMaterial = new THREE.SpriteNodeMaterial();
smokeMaterial.positionNode = smokePos;

// Smoke starts large and expands to 1.85x as it rises
const smokeScaleEnvelope = smokeLife.mix( float( 0.85 ), float( 1.85 ), smokeLife ).mul( smokeLife.oneMinus().pow( 0.5 ) );
smokeMaterial.scaleNode = smokeScale.mul( smokeScaleEnvelope );

// Volumetric Light Simulation with Falloff over distance/lifetime:
// - As the particle rises (higher smokeLife), the orange fire light strength fades to 0
const fireLightStrength = smoothstep( float( 0.8 ), float( 0.0 ), smokeLife );
const lightFromFlame = smoothstep( 1.0, 0.0, uv().y ).mul( fireLightStrength );
const lightFromAmbient = uv().y;
const smokeBaseColor = mix( color( 0x111111 ), color( 0xff5500 ).mul( 0.45 ), lightFromFlame );
const smokeLitColor = mix( smokeBaseColor, color( 0x2c3540 ).mul( 0.3 ), lightFromAmbient );

smokeMaterial.colorNode = smokeLitColor;

// Smoke starts gently with a fade-in at the bottom
const smokeFadeIn = smoothstep( float( 0.0 ), float( 0.25 ), smokeLife );
smokeMaterial.opacityNode = smokePuff.mul( smokeLife.oneMinus() ).mul( 0.32 ).mul( smokeFadeIn ); // semi-transparent
smokeMaterial.transparent = true;
smokeMaterial.depthWrite = false;
smokeMaterial.blending = THREE.NormalBlending;

const smokeParticles = new THREE.Sprite( smokeMaterial );
smokeParticles.count = smokeCount;
smokeParticles.renderOrder = 1;
smokeParticles.frustumCulled = false;
scene.add( smokeParticles );

// Spark Particle Emitter (Tiny Embers)
// Extra slow spark range (speed: 0.1 to 0.22, heightY: 0.6 to 1.2 spawning)
const sparkRand = range( vec4( 0.0, 0.10, 0.0, 0.0 ), vec4( 1.0, 0.22, 1.0, 1.0 ) );
const sparkOffset = sparkRand.x;
const sparkSpeed = sparkRand.y;

// Map Z and W components to a wider circular base of radius 0.65 to disperse them
const sparkRadiusBase = sparkRand.z.mul( 0.65 );
const sparkAngleBase = sparkRand.w.mul( Math.PI * 2.0 );
const sparkBaseX = sparkAngleBase.cos().mul( sparkRadiusBase );
const sparkBaseZ = sparkAngleBase.sin().mul( sparkRadiusBase );

const sparkScale = range( 0.01, 0.06 );
const sparkLife = speedTime.mul( sparkSpeed ).add( sparkOffset ).fract();

// Spark starts right at ground level (together with the fire) and rises to a higher altitude
const sparkY = mix( range( 0.0, 0.2 ), range( 2.2, 3.8 ), sparkLife );

// Sparks spawn in a narrower circle at the base and spread out significantly as they rise
const sparkSpread = sparkLife.mix( float( 0.35 ), float( 2.5 ), sparkLife );
const sparkBasePos = vec3( sparkBaseX.mul( sparkSpread ), sparkY, sparkBaseZ.mul( sparkSpread ) );

// Add static random dispersion offsets that grow with life to scatter sparks as they rise
const sparkScatterX = hash( instanceIndex.add( 88.0 ) ).sub( 0.5 ).mul( 1.5 ).mul( sparkLife.pow( 1.2 ) );
const sparkScatterZ = hash( instanceIndex.add( 99.0 ) ).sub( 0.5 ).mul( 1.5 ).mul( sparkLife.pow( 1.2 ) );

// Apply curlNoise displacement dynamically over time for fluid-like vortex sway (stronger multiplier for dispersion)
const sparkNoiseCoord = vec3(
	sparkOffset.mul( 5.0 ),
	sparkLife.mul( 0.6 ), // slow vertical progression along noise field
	speedTime.mul( 0.15 ) // slow field animation
);
const sparkNoiseOffset = curlNoise( sparkNoiseCoord ).mul( 0.35 ).mul( sparkLife.pow( 1.0 ) );
const sparkPos = sparkBasePos.add( vec3( sparkScatterX, float( 0.0 ), sparkScatterZ ) ).add( sparkNoiseOffset );

// pointed sparks: stretch UVs horizontally to compress spark into thin vertically elongated dashes
const sparkUv = uv().sub( vec2( 0.5, 0.5 ) ).mul( vec2( 3.5, 1.0 ) ).add( vec2( 0.5, 0.5 ) );

// High-fidelity circular glow using stretched UVs: yields sharp vertical needle streaks
const sparkDist = sparkUv.sub( 0.5 ).length();
const sparkGlow = sparkDist.mul( 2.0 ).oneMinus().clamp().pow( 3.0 );

// Varied intensities based on instance index to simulate different temperatures
const sparkIntensity = hash( instanceIndex.add( 77.0 ) ).mul( 5.0 ).add( 2.0 ); // 2.0 to 7.0

const sparkMaterial = new THREE.SpriteNodeMaterial();
sparkMaterial.positionNode = sparkPos;
sparkMaterial.scaleNode = sparkScale.mul( sparkLife.oneMinus().pow( 0.5 ) ); // shrink slowly
sparkMaterial.colorNode = color( 0xffaa00 ).mul( sparkIntensity ); // glowing gold with varied brightness

// Sparks fade in smoothly at the start of their lifetime
const sparkFadeIn = smoothstep( float( 0.0 ), float( 0.6 ), sparkLife );
sparkMaterial.opacityNode = sparkGlow.mul( sparkLife.oneMinus() ).mul( sparkFadeIn );
sparkMaterial.transparent = true;
sparkMaterial.depthWrite = false;
sparkMaterial.blending = THREE.AdditiveBlending;

const sparkParticles = new THREE.Sprite( sparkMaterial );
sparkParticles.count = sparkCount;
sparkParticles.renderOrder = 3;
sparkParticles.frustumCulled = false;
scene.add( sparkParticles );

// Point Light (Flickering Fire Glow)
const fireLight = new THREE.PointLight();
fireLight.distance = 6.0;
fireLight.position.set( 0, 0.8, 0 );

// Flicker intensity calculated purely via TSL using noise over time (ranges between 10.0 and 14.0)
const lightFlicker = mx_noise_float( vec3( speedTime.mul( 15.0 ), float( 0.0 ), float( 0.0 ) ) ).add( 1.0 ).mul( 0.5 );
const lightIntensity = mix( float( 10.0 ), float( 14.0 ), lightFlicker );

fireLight.colorNode = color( 0xff5500 ).mul( lightIntensity );
scene.add( fireLight );

// Adjust camera angle for a better view
camera.position.set( - 4, 0.4, - 1 );
```
