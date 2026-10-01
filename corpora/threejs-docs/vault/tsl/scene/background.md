# Background

Custom procedural backgrounds and skyboxes assigned directly to `scene.backgroundNode`.

<code name="iblSky" default="true">IBL Atmosphere & Clouds</code>
<code name="auroraSky">3D Aurora & Stars</code>

::: api scene.backgroundNode : Node - Assign a node to control the scene's background color or texture graph. :::

```tsl iblSky
import 'scenes/empty';
import { RepeatWrapping } from 'three';
import { positionWorldDirection, pmremTexture, color, float, vec3, time, smoothstep, mx_noise_float, Fn, rtt, uv } from 'three/tsl';

// 1. Ray Direction Vector & Corrected IBL Sampling Direction
const dir = positionWorldDirection;
const iblDir = vec3( dir.x, dir.y.negate(), dir.z );
const horizonFade = smoothstep( 0.01, 0.2, dir.y );

// 2. Single Completely Blurred PMREM Environment Texture (blur level = 1.0 for smooth ambient sky)
const iblSky = pmremTexture( scene.environment, iblDir, float( 1.0 ) );
const groundColor = iblSky.mul( 0.2 );

// 3. Perspective Sky Ceiling Projection (Perspective Foreshortening)
const skyY = dir.y.clamp( 0.001, 1.0 ).pow( 0.7 ).max( 0.08 );
const perspectivePos = vec3( dir.x.div( skyY ), float( 1.0 ), dir.z.div( skyY ) );

// 4. Volumetric FBM Cloud Noise RTT
const rttScale = float( 0.02 );

const noise = Fn( ( [ coord ] ) => {

	const p = vec3( coord.x, float( 1.0 ), coord.y ).div( rttScale );
	const wind = vec3( time.mul( 0.1 ), 0.0, time.mul( 0.015 ) );
	const animatedP = p.mul( 0.3 ).add( wind );

	const n1 = mx_noise_float( animatedP ).mul( 0.5 ).add( 0.5 ).mul( 0.50 );
	const n2 = mx_noise_float( animatedP.mul( 2.0 ) ).mul( 0.5 ).add( 0.5 ).mul( 0.25 );
	const n3 = mx_noise_float( animatedP.mul( 4.0 ) ).mul( 0.5 ).add( 0.5 ).mul( 0.125 );
	const n4 = mx_noise_float( animatedP.mul( 8.0 ) ).mul( 0.5 ).add( 0.5 ).mul( 0.0625 );

	return n1.add( n2 ).add( n3 ).add( n4 );

} );

const cloudNoiseRTT = rtt( noise( uv() ), 512, 512, { wrapS: RepeatWrapping, wrapT: RepeatWrapping } );

const cloudNoise = ( uv ) => cloudNoiseRTT.sample( uv.xz.mul( rttScale ).add( 0.5 ) ).x;
// const cloudNoise = ( uv ) => noise( uv.xz.mul( rttScale ) ).x;

// Smooth anti-aliased cloud density
const fbmVal = cloudNoise( perspectivePos );
const cloudDensity = smoothstep( 0.25, 0.55, fbmVal ).mul( horizonFade ).clamp( 0.0, 1.0 );

// 5. Cloud Normal Gradient & Color Derived 100% from iblSky
const fbmDx = cloudNoise( perspectivePos.add( vec3( 0.05, 0.0, 0.0 ) ) );
const fbmDz = cloudNoise( perspectivePos.add( vec3( 0.0, 0.0, 0.05 ) ) );
const rawNormal = vec3( fbmVal.sub( fbmDx ), float( 0.35 ), fbmVal.sub( fbmDz ) ).normalize();

// Cloud Lit & Shadow colors derived directly from iblSky (NO second pmremTexture call!)
const cloudLitColor = iblSky.mul( 1.5 ).add( color( 0xffffff ).mul( 0.35 ) );
const cloudShadowColor = iblSky.mul( 0.45 );

// In TSL method chaining: t.mix( a, b ) interpolates from a to b by factor t
const lightFactor = rawNormal.y.clamp( 0.0, 1.0 ).pow( 0.5 );
const cloudColor = lightFactor.mix( cloudShadowColor, cloudLitColor );

// 6. Smooth Horizon Transition & Composite into scene.backgroundNode
const cloudAlpha = cloudDensity.mul( 0.85 );
const finalSky = cloudAlpha.mix( iblSky, cloudColor );

const horizonBlend = smoothstep( - 0.15, 0.15, dir.y );
const finalBackground = horizonBlend.mix( groundColor, finalSky );

// Assign to scene.backgroundNode
scene.backgroundNode = finalBackground;

// Adjust camera angle and floor visibility for a better view of the sky and clouds
camera.position.set( 4, 1, 4 );
```

```tsl auroraSky
import 'scenes/empty';
import { positionWorldDirection, color, float, time, smoothstep } from 'three/tsl';

// 1. Continuous 3D Direction Vector
const dir = positionWorldDirection;

// 2. 3D Celestial Twinkling Stars Field (using 3D spatial hashing, NO wrap seams)
const starGrid = dir.mul( 30.0 );
const starId = starGrid.floor();
const starUv = starGrid.fract().sub( 0.5 );

// Pseudo-random 3D star hash & twinkling animation
const starHash = starId.x.mul( 12.9898 ).add( starId.y.mul( 78.233 ) ).add( starId.z.mul( 37.719 ) ).sin().mul( 43758.5453 ).fract();
const twinkleSpeed = starHash.mul( 6.0 ).add( 2.0 );
const twinklePhase = starHash.mul( 62.8 );
const twinkle = time.mul( twinkleSpeed ).add( twinklePhase ).sin().mul( 0.5 ).add( 0.5 );

// Smooth horizon fade for stars
const starFade = smoothstep( 0.0, 0.2, dir.y );
const isStar = starHash.greaterThan( 0.85 ).and( dir.y.greaterThan( 0.05 ) );

// Sharp 4-Pointed Star Flare Sparkle (Pontuda & Bounded without distortion)
const starDist = starUv.length();
const absUv = starUv.abs();
const sparkArm = float( 0.0015 ).div( absUv.x.mul( absUv.y ).add( 0.0015 ) );
const starSpark = sparkArm.mul( smoothstep( 0.35, 0.0, starDist ) ).clamp( 0.0, 4.0 );

const stars = isStar.select( starSpark.mul( twinkle ).mul( starFade ), float( 0.0 ) );

// 3. 3D Organic Volumetric Aurora Waves
const w1 = dir.x.mul( 2.5 ).add( time.mul( 0.4 ) ).sin().mul( 0.15 );
const w2 = dir.z.mul( 5.0 ).sub( time.mul( 0.7 ) ).cos().mul( 0.08 );
const totalWave = w1.add( w2 );

const auroraPos = dir.y.sub( 0.2 ).add( totalWave );
const auroraMask = smoothstep( 0.0, 0.12, auroraPos ).mul( smoothstep( 0.55, 0.2, auroraPos ) );

const colorShift = dir.x.mul( 1.5 ).add( time.mul( 0.3 ) ).sin().mul( 0.5 ).add( 0.5 );
const greenCyan = colorShift.mix( color( 0x059669 ), color( 0x06b6d4 ) );
const violetPink = colorShift.mix( color( 0xa855f7 ), color( 0xec4899 ) );

const auroraColor = auroraPos.mix( greenCyan, violetPink );
const aurora = auroraColor.mul( auroraMask ).mul( 1.2 );

// 4. Smooth 3D Deep Space Skybox Gradient (100% continuous from Zenith to Nadir)
const spaceBg = dir.y.mul( 0.5 ).add( 0.5 ).clamp( 0.0, 1.0 ).pow( 0.6 ).mix( color( 0x03020c ), color( 0x0d0722 ) );

// Assign to scene.backgroundNode
scene.backgroundNode = spaceBg.add( color( 0xffffff ).mul( stars ) ).add( aurora );

// Adjust camera angle for a better view of the sky and clouds
camera.position.set( 4, .1, 6 );
```
