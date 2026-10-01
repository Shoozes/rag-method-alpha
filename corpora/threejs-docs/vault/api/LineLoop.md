*Inheritance: EventDispatcher → Object3D → Line →*

# LineLoop

A continuous line. This is nearly the same as [Line](Line.md) the only difference is that the last vertex is connected with the first vertex in order to close the line to form a loop.

## Constructor

### new LineLoop( geometry : BufferGeometry, material : Material | Array.<Material> )

Constructs a new line loop.

**geometry**

The line geometry.

**material**

The line material.

## Properties

### .isLineLoop : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[src/objects/LineLoop.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/objects/LineLoop.js)
