*Inheritance: EventDispatcher → BufferGeometry → PolyhedronGeometry →*

# OctahedronGeometry

A geometry class for representing an octahedron.

## Code Example

```js
const geometry = new THREE.OctahedronGeometry();
const material = new THREE.MeshBasicMaterial( { color: 0xffff00 } );
const octahedron = new THREE.Mesh( geometry, material );
scene.add( octahedron );
```

## Constructor

### new OctahedronGeometry( radius : number, detail : number )

Constructs a new octahedron geometry.

**radius**

Radius of the octahedron.

Default is `1`.

**detail**

Setting this to a value greater than `0` adds vertices making it no longer a octahedron.

Default is `0`.

## Properties

### .parameters : Object

Holds the constructor parameters that have been used to generate the geometry. Any modification after instantiation does not change the geometry.

**Overrides:** [PolyhedronGeometry#parameters](PolyhedronGeometry.md#parameters)

## Static Methods

### .fromJSON( data : Object ) : OctahedronGeometry

Factory method for creating an instance of this class from the given JSON object.

**data**

A JSON object representing the serialized geometry.

**Returns:** A new instance.

## Source

[src/geometries/OctahedronGeometry.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/geometries/OctahedronGeometry.js)
