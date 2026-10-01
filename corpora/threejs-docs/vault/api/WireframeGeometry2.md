*Inheritance: InstancedBufferGeometry → LineSegmentsGeometry →*

# WireframeGeometry2

A special type of line segments geometry intended for wireframe rendering.

This is used in [Wireframe](Wireframe.md) to describe the shape.

## Code Example

```js
const geometry = new THREE.IcosahedronGeometry();
const wireframeGeometry = new WireframeGeometry2( geo );
```

## Import

WireframeGeometry2 is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { WireframeGeometry2 } from 'three/addons/lines/WireframeGeometry2.js';
```

## Constructor

### new WireframeGeometry2( geometry : BufferGeometry )

Constructs a new wireframe geometry.

**geometry**

The geometry to render the wireframe for.

## Properties

### .isWireframeGeometry2 : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[examples/jsm/lines/WireframeGeometry2.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/lines/WireframeGeometry2.js)
