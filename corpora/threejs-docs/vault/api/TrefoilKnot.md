*Inheritance: Curve →*

# TrefoilKnot

A Trefoil Knot.

## Import

TrefoilKnot is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { TrefoilKnot } from 'three/addons/curves/CurveExtras.js';
```

## Constructor

### new TrefoilKnot( scale : number )

Constructs a new Trefoil Knot.

**scale**

The curve's scale.

Default is `10`.

## Properties

### .scale : number

The curve's scale.

Default is `10`.

## Methods

### .getPoint( t : number, optionalTarget : Vector3 ) : Vector3

This method returns a vector in 3D space for the given interpolation factor.

**t**

A interpolation factor representing a position on the curve. Must be in the range `[0,1]`.

**optionalTarget**

The optional target vector the result is written to.

**Overrides:** [Curve#getPoint](Curve.md#getPoint)

**Returns:** The position on the curve.

## Source

[examples/jsm/curves/CurveExtras.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/curves/CurveExtras.js)
