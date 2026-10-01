# Compute Stage

The **Compute Stage** allows you to perform general-purpose parallel computations (GPGPU) directly on the GPU using compute shaders. This is useful for complex physics simulations, particle updates, procedural geometry deformations, and image processing.

GPU compute execution is structured into a hierarchy of execution units:
- **Grid / Dispatch**: The entire global execution grid containing all invocations.
- **Workgroups**: Local thread blocks (e.g. `[ 64 ]`, `[ 16, 16 ]`) executing concurrently with shared on-chip memory `workgroupArray()` and synchronization barriers `workgroupBarrier()`.
- **Subgroups (Warps / Wavefronts)**: Hardware SIMD execution units (e.g. 32 or 64 threads) that can share and reduce data directly via hardware wave intrinsics (`subgroupAdd()`, `subgroupBroadcast()`, `subgroupElect()`) without shared memory overhead.

<code name="computeParticleSystem" default="true">Particle example</code>
<code name="computeGeometry">Compute geometry example</code>
<code name="computeWorkgroup">Workgroup example</code>

### Functions

::: api compute( node, count, workgroupSize? ) : ComputeNode - Wraps a TSL function into a compute node with a specified total invocation count and workgroup dimensions.
- **node**: `Node` - TSL function containing the compute shader logic.
- **count**: `number` - Total number of invocations to dispatch.
- **workgroupSize**: `Array<number>` - (Optional) 1D, 2D, or 3D workgroup dimensions. Defaults to `[ 64 ]`.
:::

::: api .compute( count, workgroupSize? ) : ComputeNode - Chains a compute dispatch definition directly onto a TSL function call.
- **count**: `number` - Total number of invocations to dispatch.
- **workgroupSize**: `Array<number>` - (Optional) Workgroup thread dimensions. Defaults to `[ 64 ]`.
:::

::: api workgroupArray( type, count ) : Node - Allocates high-speed on-chip shared memory accessible by all invocations within the local workgroup.
- **type**: `string` - The data type of the buffer elements (e.g. `'float'`, `'vec3'`, `'vec4'`).
- **count**: `number` - Total number of elements in the workgroup buffer.
:::

::: api workgroupBarrier() : Node - Emits an execution and memory barrier ensuring all invocations in the workgroup reach this point before proceeding.
:::

::: api storageBarrier() : Node - Emits a memory barrier ensuring all pending storage buffer read and write operations are synchronized.
:::

### Built-in Identifiers

::: api instanceIndex : uint - Linearized 1D global invocation index across the entire compute dispatch. :::

::: api globalId : uvec3 - 3D coordinates of the current invocation within the global compute grid. :::

::: api localId : uvec3 - 3D coordinates of the current invocation within its local workgroup. :::

::: api workgroupId : uvec3 - 3D index of the workgroup the current invocation belongs to. :::

::: api numWorkgroups : uvec3 - Total number of dispatched workgroups along the X, Y, and Z dimensions. :::

::: api subgroupSize : uint - Hardware size of the active subgroup (warp size, typically 32 or 64). :::

### Subgroup Functions (Wave Intrinsics)

::: api subgroupElect() : bool - Returns true for the lowest active invocation ID in the subgroup, electing a single leader thread. :::

::: api subgroupAdd( value ) : Node - Performs a parallel sum reduction across all active invocations in the subgroup. :::

::: api subgroupInclusiveAdd( value ) : Node - Calculates a prefix sum scan inclusive of the current invocation's value. :::

::: api subgroupExclusiveAdd( value ) : Node - Calculates a prefix sum scan exclusive of the current invocation's value. :::

::: api subgroupMul( value ) : Node - Performs a parallel multiplication reduction across all active invocations in the subgroup. :::

::: api subgroupMin( value ) : Node - Returns the minimum value across all active invocations in the subgroup. :::

::: api subgroupMax( value ) : Node - Returns the maximum value across all active invocations in the subgroup. :::

::: api subgroupAll( boolNode ) : bool - Returns true if the boolean predicate is true for all active invocations in the subgroup. :::

::: api subgroupAny( boolNode ) : bool - Returns true if the boolean predicate is true for any active invocation in the subgroup. :::

::: api subgroupBroadcast( value, id ) : Node - Broadcasts the value from invocation `id` to all invocations in the subgroup. :::

::: api subgroupBroadcastFirst( value ) : Node - Broadcasts the value from the first active invocation in the subgroup. :::

::: api subgroupShuffle( value, index ) : Node - Exchanges values between invocations in the subgroup at specified lane indices. :::

::: api subgroupBallot( boolNode ) : uvec4 - Returns a bitmask representing which active invocations satisfy the boolean condition. :::

```tsl computeGeometry
import 'scenes/empty';
import * as THREE from 'three';
import { Fn, storage, attributeArray, instanceIndex, time, vertexIndex } from 'three/tsl';

// 1. Create a Torus geometry
const geometry = new THREE.TorusGeometry( 1, 0.35, 64, 128 );
const count = geometry.attributes.position.count;

// 2. Create storage buffers for base and computed positions
const basePositions = storage( new THREE.StorageBufferAttribute( geometry.attributes.position.array, 3 ), 'vec3', count );
const currentPositions = attributeArray( count, 'vec3' );

// 3. Define a compute shader that deforms vertices over time
const computeWave = Fn( () => {

	const basePos = basePositions.element( instanceIndex );
	const currentPos = currentPositions.element( instanceIndex );

	// Calculate waving displacement based on vertex position and time
	const waveOffset = basePos.x.mul( 3.0 ).add( time.mul( 2.0 ) ).sin().mul( 0.15 );
	const displacedPos = basePos.add( basePos.normalize().mul( waveOffset ) );

	currentPos.assign( displacedPos );

	return currentPositions.element( vertexIndex );

} )().compute( count );

// 4. Create a node material and trigger compute execution before each render
const material = new THREE.MeshStandardNodeMaterial( { roughness: 0.3, metalness: 0.8 } );

material.positionNode = computeWave;

// Set dynamic colors based on computed positions
material.colorNode = computeWave.add( 0.5 );

// 5. Create the mesh and add it to the scene
const mesh = new THREE.Mesh( geometry, material );
mesh.position.set( 0, 1.2, 0 );
scene.add( mesh );
```

```tsl computeParticleSystem
import 'scenes/empty';
import * as THREE from 'three';
import { Fn, instancedArray, instanceIndex, time, OnBeforeMaterialUpdate, hash, If } from 'three/tsl';

const particleCount = 1024;

// 1. Declare Storage Buffers and Spawn Area Config
const area = { width: 7.0, height: 10.0, depth: 7.0 };

const positions = instancedArray( particleCount, 'vec3' );
const velocities = instancedArray( particleCount, 'vec3' );

// 2. Define the Initialization Compute Shader
const computeInit = Fn( () => {

	const pos = positions.element( instanceIndex );
	const vel = velocities.element( instanceIndex );

	// Stagger Y heights to distribute the starts
	pos.x = hash( instanceIndex ).sub( 0.5 ).mul( area.width );
	pos.y = hash( instanceIndex.add( 1.0 ) ).mul( area.height + 2.0 ).sub( 2.0 ); // Staggered height
	pos.z = hash( instanceIndex.add( 2.0 ) ).sub( 0.5 ).mul( area.depth );

	// Small downward starting velocity
	vel.x = hash( instanceIndex.add( 3.0 ) ).sub( 0.5 ).mul( 0.02 );
	vel.y = hash( instanceIndex.add( 4.0 ) ).mul( - 0.02 );
	vel.z = hash( instanceIndex.add( 5.0 ) ).sub( 0.5 ).mul( 0.02 );

} )().compute( particleCount );

// 3. Define the Update Compute Shader
const computeUpdate = Fn( () => {

	const pos = positions.element( instanceIndex );
	const vel = velocities.element( instanceIndex );

	// Apply gravity
	vel.y.subAssign( 0.002 );

	// Update position
	pos.addAssign( vel );

	// Floor collision (grid helper height in scenes/empty is -2)
	const floorLevel = - 2.0;
	If( pos.y.lessThan( floorLevel ), () => {

		pos.y = floorLevel;

		// Bounce with randomized damping (between 0.4 and 0.7)
		const bounceDamping = hash( instanceIndex.add( time ) ).mul( 0.3 ).add( 0.4 );
		vel.y = vel.y.negate().mul( bounceDamping );

		// Friction
		vel.x = vel.x.mul( 0.9 );
		vel.z = vel.z.mul( 0.9 );

		// Reset particle when it comes to rest on the floor to loop the animation
		If( vel.y.abs().lessThan( 0.02 ), () => {

			pos.x = hash( instanceIndex.add( time ) ).sub( 0.5 ).mul( area.width );
			pos.y = area.height; // Reset to the top spawn height
			pos.z = hash( instanceIndex.add( time.add( 1.0 ) ) ).sub( 0.5 ).mul( area.depth );

			vel.x = hash( instanceIndex.add( time.add( 2.0 ) ) ).sub( 0.5 ).mul( 0.02 );
			vel.y = hash( instanceIndex.add( time.add( 3.0 ) ) ).mul( - 0.02 ); // Falling start
			vel.z = hash( instanceIndex.add( time.add( 4.0 ) ) ).sub( 0.5 ).mul( 0.02 );

		} );

	} );

} )().compute( particleCount );

// 4. Create a sprite material and register automatic compute updates
const material = new THREE.SpriteNodeMaterial( {
	scaleNode: 0.12,
	colorNode: velocities.toAttribute().normalize().mul( 0.5 ).add( 0.5 )
} );

material.positionNode = Fn( () => {

	let initialized = false;

	OnBeforeMaterialUpdate( ( { renderer } ) => {

		if ( ! initialized ) {

			renderer.compute( computeInit );

			initialized = true;

		}

		renderer.compute( computeUpdate );

	} );

	return positions.element( instanceIndex );

} )();

// 5. Create sprite object and add to scene
const particles = new THREE.Sprite( material );
particles.count = particleCount;
particles.frustumCulled = false;
scene.add( particles );
```

```tsl computeWorkgroup
import 'scenes/plane';
import * as THREE from 'three';
import { Fn, workgroupArray, workgroupBarrier, localId, instanceIndex, uvec2, vec3, vec4, float, uint, time, texture, textureStore } from 'three/tsl';

// 1. Create a 2D grid (128x128) and Storage Texture displayed on a Plane
const width = 128, height = 128;
const storageTex = new THREE.StorageTexture( width, height );

// 2. Allocate 2D shared workgroup memory (16x16 = 256 threads per tile)
const workgroupSizeX = 16, workgroupSizeY = 16;
const sharedCache = workgroupArray( 'vec3', workgroupSizeX * workgroupSizeY );

// 3. Define compute shader with a cross-thread read hazard
const computeStep = Fn( () => {

	const posX = instanceIndex.mod( width );
	const posY = instanceIndex.div( width );
	const indexUV = uvec2( posX, posY );

	// Local 1D index within the 16x16 workgroup tile (0 to 255)
	const lid = localId.y.mul( workgroupSizeX ).add( localId.x );

	// Phase 1 (Write): Each thread writes a smooth wave color to shared memory
	const t = time.mul( 2.5 );
	const gx = float( posX ).div( float( width ) ).mul( 6.0 );
	const gy = float( posY ).div( float( height ) ).mul( 6.0 );

	const r = gx.add( t ).sin().mul( 0.5 ).add( 0.5 );
	const g = gy.add( t.mul( 0.7 ) ).sin().mul( 0.5 ).add( 0.5 );
	const b = gx.add( gy ).sub( t ).sin().mul( 0.5 ).add( 0.5 );

	sharedCache.element( lid ).assign( vec3( r, g, b ) );

	// Synchronization Barrier:
	// Ensures all 256 threads in the tile finish writing before any thread reads.
	// -> Try commenting out the barrier below to see severe tearing and tile corruption across the plane!
	workgroupBarrier();

	// Phase 2 (Cross-thread Read): Read the diagonally inverted lane in the tile
	const invertedLid = uint( ( workgroupSizeX * workgroupSizeY ) - 1 ).sub( lid );
	const finalColor = sharedCache.element( invertedLid );

	textureStore( storageTex, indexUV, vec4( finalColor, 1.0 ) ).toWriteOnly();

} )().compute( width * height, [ workgroupSizeX, workgroupSizeY ] );

// 4. Run compute step on every frame
export function update() {

	renderer.compute( computeStep );

}

// 5. Display the storage texture on the plane
plane.material.colorNode = texture( storageTex );
```

#### Related
- [Storage](#storage)
- [Storage Texture](#storage-texture)
- [Atomic](#atomic)
