# Transpiler

The Three.js **Transpiler** is an AST-driven shader translation system that converts shader code between different shading languages. It allows developers to automatically translate legacy **GLSL** shaders into modern **TSL** (Three.js Shading Language) or native **WGSL** (WebGPU Shading Language).

<code name="glslTFnExample" default="true">glslTFn (Cross-Backend)</code>
<code name="manualTranspileExample">Manual Transpilation</code>

### Architecture

The transpiler relies on a modular architecture where a **Decoder** parses source code into an intermediate Abstract Syntax Tree (AST), the **Linker** resolves symbol dependencies, and an **Encoder** generates the target language:

| Language | Decoder | Encoder |
| :--- | :--- | :--- |
| **GLSL** | `GLSLDecoder` | - |
| **WGSL** | - | `WGSLEncoder` |
| **TSL** | - | `TSLEncoder` |

```js
import Transpiler from 'three/addons/transpiler/Transpiler.js';
import GLSLDecoder from 'three/addons/transpiler/GLSLDecoder.js';
import TSLEncoder from 'three/addons/transpiler/TSLEncoder.js';
import WGSLEncoder from 'three/addons/transpiler/WGSLEncoder.js';

const glslCode = `
	vec3 desaturate( vec3 color ) {
		vec3 lum = vec3( 0.299, 0.587, 0.114 );
		return vec3( dot( lum, color ) );
	}
`;

// Transpile GLSL to TSL JavaScript
const tslTranspiler = new Transpiler( new GLSLDecoder(), new TSLEncoder() );
const tslCode = tslTranspiler.parse( glslCode );

// Transpile GLSL to WGSL
const wgslTranspiler = new Transpiler( new GLSLDecoder(), new WGSLEncoder() );
const wgslCode = wgslTranspiler.parse( glslCode );
```

### Cross-Backend Functions: `glslTFn`

While `glslFn` runs natively on WebGL backends, WebGPU requires WGSL. By leveraging the second `builder` parameter inside a TSL `Fn()`, we can create **`glslTFn`**: a hybrid function node that detects the active renderer backend and dynamically transpiles GLSL to WGSL on WebGPU, while retaining native GLSL execution on WebGL.

```js
import Transpiler from 'three/addons/transpiler/Transpiler.js';
import GLSLDecoder from 'three/addons/transpiler/GLSLDecoder.js';
import WGSLEncoder from 'three/addons/transpiler/WGSLEncoder.js';
import { Fn, glslFn, wgslFn } from 'three/tsl';

export const glslTFn = ( code, includes = [] ) => {

	let compiledWGSLFn = null;
	let compiledGLSLFn = null;

	return Fn( ( params, builder ) => {

		// Detect active renderer backend
		if ( builder.renderer.backend.isWebGPUBackend ) {

			if ( compiledWGSLFn === null ) {

				const transpiler = new Transpiler( new GLSLDecoder(), new WGSLEncoder() );
				const wgslCode = transpiler.parse( code );

				compiledWGSLFn = wgslFn( wgslCode, includes );

			}

			return compiledWGSLFn( ...params );

		} else {

			if ( compiledGLSLFn === null ) {

				compiledGLSLFn = glslFn( code, includes );

			}

			return compiledGLSLFn( ...params );

		}

	} );

};
```

```tsl glslTFnExample
import 'scenes/shaderball';
import Transpiler from 'three/addons/transpiler/Transpiler.js';
import GLSLDecoder from 'three/addons/transpiler/GLSLDecoder.js';
import WGSLEncoder from 'three/addons/transpiler/WGSLEncoder.js';
import { Fn, glslFn, wgslFn, positionLocal, time } from 'three/tsl';

// Dynamic transpiling GLSL function helper
const glslTFn = ( code, includes = [] ) => {

	let compiledWGSLFn = null;
	let compiledGLSLFn = null;

	return Fn( ( params, builder ) => {

		if ( builder.renderer.backend.isWebGPUBackend ) {

			if ( compiledWGSLFn === null ) {

				const transpiler = new Transpiler( new GLSLDecoder(), new WGSLEncoder() );
				const wgslCode = transpiler.parse( code );

				compiledWGSLFn = wgslFn( wgslCode, includes );

			}

			return compiledWGSLFn( ...params );

		} else {

			if ( compiledGLSLFn === null ) {

				compiledGLSLFn = glslFn( code, includes );

			}

			return compiledGLSLFn( ...params );

		}

	} );

};

// Standard GLSL code running seamlessly on both WebGPU and WebGL
const verticalWaves = glslTFn( `
	vec3 verticalWaves( vec3 pos, float t ) {

		float wave = sin( pos.y * 12.0 + t * 3.0 ) * 0.5 + 0.5;

		return mix( vec3( 0.05, 0.8, 0.7 ), vec3( 0.95, 0.2, 0.4 ), wave );

	}
` );

model.material.colorNode = verticalWaves( { pos: positionLocal, t: time } );
```

```tsl manualTranspileExample
import 'scenes/shaderball';
import Transpiler from 'three/addons/transpiler/Transpiler.js';
import GLSLDecoder from 'three/addons/transpiler/GLSLDecoder.js';
import WGSLEncoder from 'three/addons/transpiler/WGSLEncoder.js';
import { wgslFn, positionLocal, time } from 'three/tsl';

// 1. Original GLSL shader code
const glslSource = `
	vec3 verticalWaves( vec3 pos, float t ) {

		float wave = sin( pos.y * 12.0 + t * 3.0 ) * 0.5 + 0.5;

		return mix( vec3( 0.05, 0.8, 0.7 ), vec3( 0.95, 0.2, 0.4 ), wave );

	}
`;

// 2. Transpile to WGSL using Transpiler
const transpiler = new Transpiler( new GLSLDecoder(), new WGSLEncoder() );
const wgslSource = transpiler.parse( glslSource );

// 3. Create native WGSL node
const verticalWavesWGSL = wgslFn( wgslSource );

model.material.colorNode = verticalWavesWGSL( { pos: positionLocal, t: time } );
```
