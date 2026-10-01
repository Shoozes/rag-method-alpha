# TSL Extensions

### TSL Textures

https://github.com/boytchev/tsl-textures

A collection of Three.js Shading Language (TSL) textures – these are online real-time procedural generators of 3D textures.

```tsl:embed
import 'scenes/shaderball';
import * as THREE from 'three';
import { positionLocal, time } from 'three/tsl';
import { clouds } from 'tsl-textures';

const position = positionLocal.add( time.mul( 0.1 ) );

model.material.colorNode = clouds( {
	position,
	scale: 2,
	density: 0.5,
	opacity: 1,
	color: new THREE.Color( 0xffffff ),
	subcolor: new THREE.Color( 0xa0a0a0 ),
	seed: 0
} );

model.material.transparent = true;
model.material.side = THREE.DoubleSide;
model.material.opacityNode = clouds.opacity( {
	position,
	scale: 2,
	density: 0.5,
	opacity: 1,
	color: new THREE.Color( 0xffffff ),
	subcolor: new THREE.Color( 0xa0a0a0 ),
	seed: 0
} );

```

### Vite TSL Operator

https://github.com/Makio64/vite-plugin-tsl-operator

Use normal JavaScript operators like `+`, `-`, `*`, `/`, `%`, `**`, `+=`, `>`, `&&`, and `!` directly inside Three.js TSL `Fn()` blocks.

`vite-plugin-tsl-operator` is a plug-and-play Vite plugin for Three.js Shading Language (TSL), WebGPU, and shader node projects. It rewrites readable operator syntax to TSL node methods during Vite transforms, so you can write shader logic naturally without hand-chaining `.add()`, `.mul()`, `.greaterThan()`, and friends.

```js
import { uniform, Fn } from 'three/tsl';

const myFn = Fn( () => {

	const alpha = uniform( 1 );
	const color = uniform( new THREE.Color() );

	let x = 1 - alpha * color.r;
	x = x * 4;

	return x;

} );

model.material.colorNode = myFn();
```

### TypeGPU

https://github.com/software-mansion/TypeGPU

TypeGPU brings TypeScript type safety and a JavaScript-friendly syntax to WebGPU and TSL. Through the `@typegpu/three` package, you can write shaders with standard JS/TS constructs (such as `if`, `for`, and typed data structures) and seamlessly convert them to TSL nodes with `toTSL()`, or access TSL nodes inside TypeGPU using `fromTSL()`.

Just like TypeScript requires compilation, TypeGPU functions marked with `'use gpu'` rely on a build-time compiler/bundler plugin (such as `unplugin-typegpu` for Vite, Webpack, Rollup, or Babel) to transpile the code into GPU shaders.

```js
import * as THREE from 'three';
import * as t3 from '@typegpu/three';
import * as d from 'typegpu/data';
import { fract } from 'typegpu/std';

const material = new THREE.MeshBasicNodeMaterial();

material.colorNode = t3.toTSL( () => {

	'use gpu';

	const uv = t3.uv().$;

	if ( uv.x < 0.5 ) {

		return d.vec4f( fract( uv.mul( 4 ) ), 0, 1 );

	}

	return d.vec4f( 1, 0, 0, 1 );

} );
```

### TSL Sandbox

https://github.com/brunosimon/three.js-tsl-sandbox

A collection of interactive experiments and shaders created by [Bruno Simon](https://bruno-simon.com/) (creator of Three.js Journey) as a playground to learn and demonstrate the capabilities of TSL (Three.js Shading Language) and WebGPU.
