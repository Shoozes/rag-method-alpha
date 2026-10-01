# Atomic

Atomic operations in TSL allow performing synchronization-safe read-modify-write operations on GPU memory. In WebGPU, atomic operations are performed on elements of storage buffers or workgroup memory declared as atomic variables.

To create an atomic storage buffer in TSL, you declare a `storage()` node and chain the `.toAtomic()` method on it.

Example:

```js
import * as THREE from 'three';
import { storage, atomicAdd } from 'three/tsl';

// 1. Create a storage buffer attribute (e.g., 1 unsigned integer for a counter)
const counterAttr = new THREE.StorageBufferAttribute( new Uint32Array( [ 0 ] ), 1 );

// 2. Define the storage buffer in TSL and mark it as atomic
const counter = storage( counterAttr, 'uint', 1 ).toAtomic();

// 3. Perform an atomic add operation in your shader (increments the counter and returns the previous value)
const previousValue = atomicAdd( counter.element( 0 ), 1 );
```
