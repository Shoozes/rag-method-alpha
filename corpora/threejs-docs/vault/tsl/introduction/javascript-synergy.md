# JavaScript Synergy

TSL is based on Nodes, so don’t worry about sharing your **functions** and **uniforms** across materials and post-processing.

```js
// Share the same uniform across various materials

const sharedColor = uniform( new THREE.Color() );

materialA.colorNode = sharedColor.div( 2 );
materialB.colorNode = sharedColor.mul( 0.5 );
materialC.colorNode = sharedColor.add( 0.5 );
```

#### Deferred Function: High level of customization, goodbye `#defines`

Access **material**, **geometry**, **object**, **camera**, **scene**, **renderer** and more directly from a TSL function. Function calls are evaluated when building the shader, allowing you to customize logic dynamically according to object setups.

```js
// Returns a uniform of the material's custom color if it exists

const customColor = Fn( ( { material, geometry, object } ) => {

	if ( material.userData.customColor !== undefined ) {

		return uniform( material.userData.customColor );

	}

	return vec3( 0 );

} );

//

material.colorNode = customColor();

```

#### Load a texture-based matrix inside a TSL function

This can be used for any other JS and Three.js ecosystem needs. You can manipulate your assets according to the needs of a function. This can work for creating buffers, attributes, uniforms and any other JavaScript operation.

```js
let bayer16Texture = null;

export const bayer16 = Fn( ( [ uv ] ) => {

	if ( bayer16Texture === null ) {

		const bayer16Base64 = 'data:image/png;base64,...==';

		bayer16Texture = new TextureLoader().load( bayer16Base64 );

	}

	return textureLoad( bayer16Texture, ivec2( uv ).mod( int( 16 ) ) );

} );

//

material.colorNode = bayer16( screenCoordinate );

```

#### TSL loves JavaScript

TSL syntax follows JavaScript style because they are the same thing, so if you come from GLSL you can explore new possibilities.

```js
// A simple example of Function closure

const mainTask = Fn( () => {

	const task2 = Fn( ( [ a, b ] ) => {

		return a.add( b ).mul( 0.5 );

	} );

	return task2( color( 0x00ff00 ), color( 0x0000ff ) );

} );

//

material.colorNode = mainTask();
```

#### Simplified rendering tree

Two-pass `gaussianBlur()` node usable seamlessly within materials or post-processing pipelines.

```js
// Applies a double render-pass gaussianBlur and then a grayscale filter before the object with the material is rendered.

const myTexture = texture( map );

material.colorNode = grayscale( gaussianBlur( myTexture, 4 ) );
```

Accesses what has already been rendered, preserving render order for easy refraction effects, avoiding multiple render passes and manual sorting.

```js
// Rendering the background in grayscale.

material.colorNode = grayscale( viewportSharedTexture( screenUV ) );
material.transparent = true;
```

#### Extend the TSL

You no longer need to create a Material for each desired effect, instead create Nodes. A Node can have access to the Material and can be used in many ways. Extend TSL with custom Nodes to unlock creative workflows.

A great example of this is [TSL-Textures](https://boytchev.github.io/tsl-textures/):

```tsl:embed
import 'scenes/shaderball';
import * as THREE from 'three';
import { caustics } from 'tsl-textures';

model.material.colorNode = caustics( {
	scale: 2,
	speed: 0,
	color: new THREE.Color( 0x1ca3ec ),
	seed: 0
} );
```
