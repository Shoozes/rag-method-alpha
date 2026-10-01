# Why TSL?

Creating shaders has always been an advanced step for most developers; many game developers have never created shader code from scratch. The shader graph solution adopted today by the industry has allowed developers more focused on dynamics to create the necessary graphic effects to meet the demands of their projects.

The aim of the project is to create an easy-to-use environment for shader creation. Even if for this we need to create complexity behind it, this happened initially with Renderer and now with the TSL.

Other benefits of TSL, besides simplifying shader creation, include remaining **renderer-agnostic**, while all the complexity of a material can be modularized and benefit from **tree shaking** without breaking during the process.

### Example

A **detail map** makes things look more real in games. It adds tiny details like cracks or bumps to surfaces. In this example we will scale uv to improve details when seen up close and multiply with a base texture.

#### Old

This is how we would achieve that using `.onBeforeCompile()`:

```js
const material = new THREE.MeshStandardMaterial();
material.map = colorMap;
material.onBeforeCompile = ( shader ) => {

	shader.uniforms.detailMap = { value: detailMap };

	let token = '#define STANDARD';

	let insert = /* glsl */`
		uniform sampler2D detailMap;
	`;

	shader.fragmentShader = shader.fragmentShader.replace( token, token + insert );

	token = '#include <map_fragment>';

	insert = /* glsl */`
		diffuseColor *= texture2D( detailMap, vMapUv * 10.0 );
	`;

	shader.fragmentShader = shader.fragmentShader.replace( token, token + insert );

};
```

Any simple change beyond this makes code increasingly complicated using `.onBeforeCompile()`. The result in the community is countless parametric materials that cannot interoperate and need to be updated periodically to remain operational, limiting the ability to create unique materials by reusing modular components.

#### New

With TSL the code would look like this:

```js
import { texture, uv } from 'three/tsl';

const detail = texture( detailMap, uv().mul( 10 ) );

const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = texture( colorMap ).mul( detail );
```

TSL is also capable of encoding code into different outputs such as WGSL/GLSL - WebGPU/WebGL, in addition to optimizing the shader graph automatically and through code that can be inserted within each Node. This allows the developer to focus on productivity and leave the graphical management part to the Node System.

Another important feature of a graph shader is that we will no longer need to care about the sequence in which components are created, because the Node System will only declare and include it once.

Let's say that you import positionWorld into your code, even if another component uses it, the calculations performed to obtain positionWorld will only be performed once, as is the case with any other node such as: normalWorld, modelPosition, etc.
