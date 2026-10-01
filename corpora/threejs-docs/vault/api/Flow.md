# Flow

A modifier for making meshes bend around curves.

This module can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), import the class from `CurveModifierGPU.js`.

## Import

Flow is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { Flow } from 'three/addons/modifiers/CurveModifier.js';
```

## Constructor

### new Flow( mesh : Mesh, numberOfCurves : number )

Constructs a new Flow instance.

**mesh**

The mesh to clone and modify to bend around the curve.

**numberOfCurves**

The amount of space that should preallocated for additional curves.

Default is `1`.

## Classes

[Flow](Flow.md)

## Methods

### .moveAlongCurve( amount : number )

Moves the mesh along the curve.

**amount**

The offset.

### .updateCurve( index : number, curve : Curve )

Updates the curve for the given curve index.

**index**

The curve index.

**curve**

The curve that should be used to bend the mesh.

## Source

[examples/jsm/modifiers/CurveModifier.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/modifiers/CurveModifier.js)
