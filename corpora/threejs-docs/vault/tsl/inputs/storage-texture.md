# Storage Texture

Storage textures allow compute shaders to read and write pixel/texel data directly on the GPU.

They are ideal for procedural texture generation, image processing filters, fluid simulations, and GPGPU cellular automata.

<code name="storageTextureExample" default="true">Compute Storage Texture</code>

### Functions

::: api storageTexture( value, uv? ) : vec4 - Creates a storage texture node for read/write texel access.
- **value**: `StorageTexture` - The storage texture instance.
- **uv**: `uvec2 | vec2` - (Optional) Texel coordinates.
:::

::: api textureStore( texture, uv, value ) : Node - Writes a value to a storage texture at specified texel coordinates.
- **texture**: `StorageTexture | Node` - The storage texture instance or node.
- **uv**: `uvec2 | vec2` - Texel coordinate where the value will be stored.
- **value**: `vec4` - The color or data value to write.
:::

::: api storageTexture3D( value, uv? ) : vec4 - Creates a 3D volumetric storage texture node.
- **value**: `Storage3DTexture` - The 3D storage texture instance.
- **uv**: `uvec3 | vec3` - (Optional) 3D texel coordinates.
:::

### Methods

::: api .toWriteOnly() : Node - Sets the storage texture access mode to write-only. :::

::: api .toReadOnly() : Node - Sets the storage texture access mode to read-only. :::

::: api .toReadWrite() : Node - Sets the storage texture access mode to read-write. :::

::: api .setMipLevel( level: int ) : Node - Sets the mipmap level to write to. :::

```tsl storageTextureExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { Fn, instanceIndex, float, uvec2, vec2, vec3, vec4, texture, textureStore, time, color, mx_fractal_noise_float, mx_noise_vec3 } from 'three/tsl';

// 1. Create a 256x256 StorageTexture on the GPU
const width = 256, height = 256;
const storageTex = new THREE.StorageTexture( width, height );

// 2. Define a compute shader that writes seamless procedural noise into the storage texture
const computeTexture = Fn( () => {

	const posX = instanceIndex.mod( width );
	const posY = instanceIndex.div( width );
	const indexUV = uvec2( posX, posY );

	// Normalized texture coordinates
	const uvCoord = vec2( float( posX ).div( float( width ) ), float( posY ).div( float( height ) ) );

	// Seamless periodic torus mapping (eliminates all texture UV seams)
	const angleU = uvCoord.x.mul( Math.PI * 2.0 );
	const angleV = uvCoord.y.mul( Math.PI * 2.0 );

	const torusX = angleU.cos().mul( 1.5 ).add( angleV.cos().mul( 0.5 ) );
	const torusY = angleU.sin().mul( 1.5 ).add( angleV.cos().mul( 0.5 ) );
	const torusZ = angleV.sin().mul( 1.5 );

	// Animate noise domain with time
	const speed = time.mul( 0.3 );
	const noiseInput = vec3( torusX, torusY, torusZ.add( speed ) );

	// Domain warped organic fractal noise
	const warp = mx_noise_vec3( noiseInput ).mul( 0.35 );
	const n = mx_fractal_noise_float( noiseInput.add( warp ), 4 );

	// Color mapping: deep indigo -> vibrant cyan -> glowing gold
	const colA = color( 0x050818 );
	const colB = color( 0x00d4ff );
	const colC = color( 0xff9900 );

	const col = n.mix( colA, n.mul( 1.5 ).mix( colB, colC ) );

	textureStore( storageTex, indexUV, vec4( col, 1.0 ) ).toWriteOnly();

} )().compute( width * height );

// 3. Compute texture updates on each frame
export function update() {

	renderer.compute( computeTexture );

}

// 4. Sample the storage texture in the shaderball material
const texNode = texture( storageTex );
model.material.colorNode = texNode;
```

#### Related
- [Storage](#storage)
- [Texture](#texture)
- [Compute Stage](#compute-stage)
