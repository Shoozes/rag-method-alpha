*Inheritance: EventDispatcher → Object3D → Mesh → LineSegments2 →*

# Line2

A polyline drawn between vertices.

This adds functionality beyond [Line](Line.md), like arbitrary line width and changing width to be in world units.It extends [LineSegments2](LineSegments2.md), simplifying constructing segments from a chain of points.

This module can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), import the class from `lines/webgpu/Line2.js`.

## Code Example

```js
const geometry = new LineGeometry();
geometry.setPositions( positions );
geometry.setColors( colors );
const material = new LineMaterial( { linewidth: 5, vertexColors: true } };
const line = new Line2( geometry, material );
scene.add( line );
```

## Import

Line2 is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { Line2 } from 'three/addons/lines/Line2.js';
```

## Constructor

### new Line2( geometry : LineGeometry, material : LineMaterial )

Constructs a new wide line.

**geometry**

The line geometry.

**material**

The line material.

## Properties

### .isLine2 : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[examples/jsm/lines/Line2.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/lines/Line2.js)
