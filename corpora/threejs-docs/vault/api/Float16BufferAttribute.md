*Inheritance: BufferAttribute →*

# Float16BufferAttribute

Convenient class that can be used when creating a `Float16` buffer attribute with a plain `Array` instance.

This class automatically converts to and from FP16 via `Uint16Array` since `Float16Array` browser support is still problematic.

## Constructor

### new Float16BufferAttribute( array : Array.<number> | Uint16Array, itemSize : number, normalized : boolean )

Constructs a new buffer attribute.

**array**

The array holding the attribute data.

**itemSize**

The item size.

**normalized**

Whether the data are normalized or not.

Default is `false`.

## Source

[src/core/BufferAttribute.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/core/BufferAttribute.js)
