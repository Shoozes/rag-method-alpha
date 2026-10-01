# Storage

Storage buffers provide read/write GPU memory for compute shaders and vertex/fragment rendering pipelines.

Unlike standard uniforms, storage buffers can be modified directly on the GPU — enabling high-performance particle physics, GPGPU simulations, and procedural geometry operations without CPU roundtrips.

<code name="storageExample" default="true">Compute Storage Buffer</code>

### Functions

::: api storage( value, type?, count? ) : Node - Creates a storage buffer node for read/write GPU buffer access.
- **value**: `StorageBufferAttribute | StorageInstancedBufferAttribute | BufferAttribute` - The buffer data attribute.
- **type**: `string` - (Optional) TSL type name (e.g. `'float'`, `'vec3'`, `'mat4'`, or a Struct).
- **count**: `number` - (Optional) Number of elements in the buffer.
:::

::: api storageBarrier() : Node - Emits a memory barrier ensuring all pending storage reads and writes are synchronized across GPU invocations.
:::

### Methods

::: api .element( index: int ) : Node - Accesses an element in the storage buffer at the specified index. :::

::: api .toAttribute() : Node - Converts the storage buffer into an attribute node for vertex or instance rendering. :::

::: api .toReadOnly() : Node - Sets the storage buffer access mode to read-only. :::

::: api .toWriteOnly() : Node - Sets the storage buffer access mode to write-only. :::

::: api .toReadWrite() : Node - Sets the storage buffer access mode to read-write. :::

::: api .toAtomic() : Node - Configures the storage buffer for atomic operations. :::

```tsl storageExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { storage, Fn, instanceIndex, time, float, color, positionLocal, normalLocal } from 'three/tsl';

// 1. Create a storage buffer for dynamic vertex displacement
const count = 1024;
const bufferAttribute = new THREE.StorageBufferAttribute( count, 1 );
const displacementBuffer = storage( bufferAttribute, 'float', count );

// 2. Compute shader that writes harmonic wave oscillations into the storage buffer
const computeDisplacement = Fn( () => {

	const idx = float( instanceIndex );
	const wave1 = time.mul( 3.0 ).add( idx.mul( 0.05 ) ).sin().mul( 0.08 );
	const wave2 = time.mul( 1.7 ).sub( idx.mul( 0.08 ) ).cos().mul( 0.04 );

	displacementBuffer.element( instanceIndex ).assign( wave1.add( wave2 ) );

} )().compute( count );

// 3. Dispatch compute pass on each frame
export function update() {

	renderer.compute( computeDisplacement );

}

// 4. Sample the computed buffer to deform the shaderball surface
const disp = displacementBuffer.element( instanceIndex.mod( count ) );
model.material.positionNode = positionLocal.add( normalLocal.mul( disp ) );

// 5. Color the mesh based on displacement intensity
const heatColor = disp.mul( 10.0 ).add( 0.5 );
model.material.colorNode = heatColor.mix( color( 0x112244 ), color( 0x00ffcc ) );
```

#### Related
- [Storage Texture](#storage-texture)
- [Storage Array](#storage-array)
- [Compute Stage](#compute-stage)
- [Atomic](#atomic)
