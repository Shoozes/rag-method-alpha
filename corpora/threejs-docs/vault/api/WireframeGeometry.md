*Inheritance: EventDispatcher → BufferGeometry →*

# WireframeGeometry

Can be used as a helper object to visualize a geometry as a wireframe.

Note: It is not yet possible to serialize/deserialize instances of this class.

## Code Example

```js
const geometry = new THREE.SphereGeometry();
const wireframe = new THREE.WireframeGeometry( geometry );
const line = new THREE.LineSegments( wireframe );
line.material.depthWrite = false;
line.material.opacity = 0.25;
line.material.transparent = true;
scene.add( line );
```

## Constructor

### new WireframeGeometry( geometry : BufferGeometry )

Constructs a new wireframe geometry.

**geometry**

The geometry.

Default is `null`.

## Properties

### .parameters : Object

Holds the constructor parameters that have been used to generate the geometry. Any modification after instantiation does not change the geometry.

## Source

[src/geometries/WireframeGeometry.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/geometries/WireframeGeometry.js)
