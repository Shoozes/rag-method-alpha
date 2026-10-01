*Inheritance: Interpolant →*

# CubicInterpolant

Fast and simple cubic spline interpolant.

It was derived from a Hermitian construction setting the first derivative at each sample position to the linear slope between neighboring positions over their parameter interval.

## Constructor

### new CubicInterpolant( parameterPositions : TypedArray, sampleValues : TypedArray, sampleSize : number, resultBuffer : TypedArray )

Constructs a new cubic interpolant.

**parameterPositions**

The parameter positions hold the interpolation factors.

**sampleValues**

The sample values.

**sampleSize**

The sample size

**resultBuffer**

The result buffer.

## Source

[src/math/interpolants/CubicInterpolant.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/math/interpolants/CubicInterpolant.js)
