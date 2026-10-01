*Inheritance: Curve →*

# CubicBezierCurve3

A curve representing a 3D Cubic Bezier curve.

## Constructor

### new CubicBezierCurve3( v0 : Vector3, v1 : Vector3, v2 : Vector3, v3 : Vector3 )

Constructs a new Cubic Bezier curve.

**v0**

The start point.

**v1**

The first control point.

**v2**

The second control point.

**v3**

The end point.

## Properties

### .isCubicBezierCurve3 : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .v0 : Vector3

The start point.

### .v1 : Vector3

The first control point.

### .v2 : Vector3

The second control point.

### .v3 : Vector3

The end point.

## Methods

### .getPoint( t : number, optionalTarget : Vector3 ) : Vector3

Returns a point on the curve.

**t**

A interpolation factor representing a position on the curve. Must be in the range `[0,1]`.

**optionalTarget**

The optional target vector the result is written to.

**Overrides:** [Curve#getPoint](Curve.md#getPoint)

**Returns:** The position on the curve.

## Source

[src/extras/curves/CubicBezierCurve3.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/extras/curves/CubicBezierCurve3.js)
