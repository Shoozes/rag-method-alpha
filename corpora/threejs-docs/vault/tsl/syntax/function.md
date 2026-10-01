# Function

It is possible to use classic JS functions or a `Fn()` interface. The main difference is that `Fn()` creates a controllable environment, allowing the use of **stack** where you can use **assign** and **conditional**, while the classic function only allows inline approaches.

```js
// tsl function
export const oscSine = Fn( ( [ t = time ] ) => {

	return t.add( 0.75 ).mul( Math.PI * 2 ).sin().mul( 0.5 ).add( 0.5 );

} );

// inline function
export const oscSineInline = ( t = time ) => t.add( 0.75 ).mul( Math.PI * 2 ).sin().mul( 0.5 ).add( 0.5 );
```
> Note: Both above can be called with `oscSine( value )` or `oscSineInline( value )`.

<code name="oscSine">oscSine example</code>

### Parameters as an Object

TSL allows passing parameters as an object, which is useful in functions with many optional arguments.

Passing parameters as an object also allows traditional positional arguments as an array, enabling flexible usage styles:

```js
const col = Fn( ( { r, g, b } ) => {

	return vec3( r, g, b );

} );

// Any of the options below will return a green color:

material.colorNode = col( 0, 1, 0 ); // option 1 (positional)
material.colorNode = col( { r: 0, g: 1, b: 0 } ); // option 2 (named object)
```

If you want to export a function compatible with **tree shaking**, remember to annotate with `/*@__PURE__*/`:

```js
export const oscSawtooth = /*@__PURE__*/ Fn( ( [ timer = time ] ) => timer.fract() );
```

In a TSL `Fn()`, the `NodeBuilder` instance is automatically passed as the last parameter (or the first if no custom arguments are defined). Through `NodeBuilder`, you can inspect the current compilation context and access scene objects such as **material**, **geometry**, **object**, **camera**, etc.

<code name="accessingMaterial">Accessing Material example</code>

```tsl oscSine
import 'scenes/shaderball';
import { Fn, time } from 'three/tsl';

// Define a custom TSL Fn to animate the color
const oscSine = Fn( ( { t = time } ) => {

	return t.add( 0.75 ).mul( Math.PI * 2 ).sin().mul( 0.5 ).add( 0.5 );

} );

// Assign it to the red component of the material color
model.material.colorNode = oscSine();
```

```tsl accessingMaterial
import 'scenes/shaderball';
import * as THREE from 'three';
import { Fn, color } from 'three/tsl';

// Store color
model.material.userData.customColor = new THREE.Color( 0x0066ff );

// Retrieve the color from builder
const getMaterialColor = Fn( ( { material } ) => {

	if ( material.userData.customColor !== undefined ) {

		return color( material.userData.customColor );

	}

	return color( 0 );

} );

// Assign color
model.material.colorNode = getMaterialColor();
```

### Function as Parameter

Functions in TSL can accept other functions or callbacks as parameters. This allows designing higher-order shader functions that delegate specific evaluations (such as sampling height maps, applying custom math transformations, or evaluating procedural channels) to the caller.

<code name="bumpMapFunctionExample">Function as Parameter example</code>

```js
const sample = ( sampleUV = uv() ) => texture( map, sampleUV ).r;

material.normalNode = customBumpMap( sample, 3.0 );
```

```tsl bumpMapFunctionExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { float, vec2, uv, normalView, positionView, faceDirection, texture, color } from 'three/tsl';

// Load texture map for bump height sampling and configure repeat wrapping
const map = new THREE.TextureLoader().load( '../examples/textures/uv_grid_opengl.jpg' );
map.wrapS = THREE.RepeatWrapping;
map.wrapT = THREE.RepeatWrapping;

// Recreated custom bumpMap function accepting a height sampler function, scale, and optional uv parameter
const customBumpMap = ( sampleHeightFn, bumpScale = float( 1.0 ), bumpUV = uv() ) => {

	const Hll = float( sampleHeightFn( bumpUV ) );

	// Calculate forward height derivatives using screen-space UV derivatives
	const dHdx = float( sampleHeightFn( bumpUV.add( bumpUV.dFdx() ) ) ).sub( Hll ).mul( bumpScale );
	const dHdy = float( sampleHeightFn( bumpUV.add( bumpUV.dFdy() ) ) ).sub( Hll ).mul( bumpScale );
	const dHdxy = vec2( dHdx, dHdy );

	// Calculate perturbed surface normal vector
	const vSigmaX = positionView.dFdx().normalize();
	const vSigmaY = positionView.dFdy().normalize();
	const vN = normalView;

	const R1 = vSigmaY.cross( vN );
	const R2 = vN.cross( vSigmaX );

	const fDet = vSigmaX.dot( R1 ).mul( faceDirection );
	const vGrad = fDet.sign().mul( dHdxy.x.mul( R1 ).add( dHdxy.y.mul( R2 ) ) );

	return fDet.abs().mul( vN ).sub( vGrad ).normalize();

};

// Height sampling function evaluating the red channel (.r) of the texture
const sample = ( sampleUV = uv() ) => texture( map, sampleUV ).r;

// Apply custom bump map with custom UV scaling directly passed to bumpMap
model.material.normalNode = customBumpMap( sample, 3.0, uv().mul( 3 ) );

// Set base material color
model.material.colorNode = color( 0x3b82f6 );
```

### Layout

A **Layout** defines the signature of a TSL function, specifying its parameter types and return type:

- **No-Layout (Default)**:
  - Generates inlined shader code directly into the execution stack.
  - Allows the function to adapt to contextual inputs, return multi-property JavaScript objects, or execute dynamic node graphs per material.

- **Layout**:
  - Generates an equivalent native function based on the `NodeBuilder` target backend (e.g. WGSL or GLSL).
  - Compiled once into the shader program and efficiently reused across materials via a persistent cache.

<code name="layoutExample">Layout example</code>

```js
// No-Layout (Default): Inlined with assignments
const clampColor = Fn( ( { val } ) => {

	const result = float( val );

	If( val.greaterThan( 1.0 ), () => {

		result.assign( 1.0 );

	} );

	return result;

} );

// Layout: Native GPU function with signature and return
const clampColorLayout = Fn( ( { val } ) => {

	If( val.greaterThan( 1.0 ), () => {

		return 1.0;

	} );

	return val;

}, { val: 'float', return: 'float' } );
```

```tsl layoutExample
import 'scenes/shaderball';
import { Fn, color, vec3, time, uv, If } from 'three/tsl';

// 1. No-Layout (Default): inlined function using assignments across branches
const getThresholdColor = Fn( ( { baseColor, threshold } ) => {

	const result = vec3( baseColor );

	If( uv().y.greaterThan( threshold ), () => {

		result.assign( color( 0x00aaff ) );

	} );

	return result;

} );

// 2. Layout: native GPU function with typed signature compiled and cached globally
const getThresholdColorLayout = Fn( ( { baseColor, threshold, uv } ) => {

	const result = vec3( baseColor );

	If( uv.y.greaterThan( threshold ), () => {

		result.assign( color( 0x00aaff ) );

	} );

	return result;

}, { baseColor: 'vec3', threshold: 'float', uv: 'vec2', return: 'vec3' } );

const threshold = time.sin().mul( 0.5 ).add( 0.5 );

// Use the default No-Layout function
model.material.colorNode = getThresholdColor( { baseColor: color( 0xff3366 ), threshold } );
// model.material.colorNode = getThresholdColorLayout( { baseColor: color( 0xff3366 ), threshold, uv: uv() } );
```

### Closure

TSL functions support JavaScript closures. A function defined with `Fn()` can contain a nested `Fn()` inside its body. The inner `Fn()` captures variables, constants, and parameters defined in the outer `Fn()` scope, allowing modular and reusable sub-functions within TSL shader graphs.

<code name="closureExample">Closure example</code>

```js
const createChecker = Fn( ( [ scale ] ) => {

	const tintColor = vec3( 0.1, 0.6, 1.0 );
	const computeChecker = Fn( ( [ customUV ] ) => checker( customUV ).mul( tintColor ) );

	return computeChecker( uv().mul( scale ) );

} );
```

> Note: Although closures are allowed, they are not always recommended because inner functions create new instances that cannot be efficiently reused in the shader cache.

```tsl closureExample
import 'scenes/shaderball';
import { Fn, vec3, uv, checker } from 'three/tsl';

// Outer TSL Fn accepting a scale parameter
const createChecker = Fn( ( [ scale ] ) => {

	const tintColor = vec3( 0.1, 0.6, 1.0 );

	// Inner TSL Fn nested inside outer Fn (capturing outer parameter 'scale' and variable 'tintColor')
	const computeChecker = Fn( ( [ customUV ] ) => {

		return checker( customUV ).mul( tintColor );

	} );

	return computeChecker( uv().mul( scale ) );

} );

model.material.colorNode = createChecker( 8.0 );
```

#### Related
  - [Sub-Builds](#sub-builds)
  - [JavaScript Synergy](#javascript-synergy)
