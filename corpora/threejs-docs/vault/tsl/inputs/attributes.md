# Attributes

Attributes are inputs that are defined per-vertex or per-instance in the geometry of a mesh.

<code name="vertexIndexExample" default="true">Vertex index example</code>
<code name="attributesExample">Attributes example</code>

### Constants

::: api instanceIndex : `uint` - The index of the current instance. :::

::: api vertexIndex : `uint` - The index of a vertex within a mesh. :::

::: api drawIndex : `uint` - The draw index when using multi-draw. :::

### Functions

::: api attribute( name, type? )
- **name**: `string` - Name of the geometry attribute.
- **type**: `string` - (Optional) Explicit TSL type name. Defaults to `null`.
:::

::: api uv( index? )
- **index**: `number` - (Optional) The UV coordinate set index. Defaults to `0`.
:::

::: api vertexColor( index? )
- **index**: `number` - (Optional) The vertex color set index. Defaults to `0`.
:::

::: api batch( batchMesh )
- **batchMesh**: `BatchedMesh` - Creates a batch node for BatchedMesh.
:::

::: api instance( instancedMesh )
- **instancedMesh**: `InstancedMesh` - Creates an instance node for InstancedMesh.
:::

```tsl attributesExample
import 'scenes/shaderball';
import { uv } from 'three/tsl';

// Map the UV coordinate attribute directly to colorNode
model.material.colorNode = uv();
```

```tsl vertexIndexExample
import 'scenes/shaderball';
import { vec3, vertexIndex, hash, positionLocal, time, color } from 'three/tsl';

// Oscillate explosion factor between 0.0 (assembled) and 1.0 (fully exploded)
const factor = time.mul( 0.8 ).sin().mul( 0.5 ).add( 0.5 );

// Group vertices by triangle (3 vertices per face) to move faces as rigid bodies
const faceIndex = vertexIndex.div( 3 );

// Generate a random explosion direction for each face using hash and faceIndex
const randomDir = vec3(
	hash( faceIndex.add( 11.0 ) ).sub( 0.5 ),
	hash( faceIndex.add( 22.0 ) ).sub( 0.5 ),
	hash( faceIndex.add( 33.0 ) ).sub( 0.5 )
).normalize();

// Randomize explosion speed for each face
const speed = hash( faceIndex ).add( 0.5 );

// Displace vertices outward (each face flies away as a flat triangle)
const displacement = randomDir.mul( factor.mul( speed ).mul( 1.5 ) );
model.material.positionNode = positionLocal.add( displacement );

// Transition color from blue (stable/cold) to orange (exploded/hot gas)
model.material.colorNode = factor.mix( color( 0x3b82f6 ), color( 0xffaa76 ) );
```
