*Inheritance: BufferAttribute →*

# StorageBufferAttribute

This special type of buffer attribute is intended for compute shaders. In earlier three.js versions it was only possible to update attribute data on the CPU via JavaScript and then upload the data to the GPU. With the new material system and renderer it is now possible to use compute shaders to compute the data for an attribute more efficiently on the GPU.

The idea is to create an instance of this class and provide it as an input to [StorageBufferNode](StorageBufferNode.md).

Note: This type of buffer attribute can only be used with `WebGPURenderer`.

## Constructor

### new StorageBufferAttribute( count : number | TypedArray, itemSize : number, typeClass : TypedArray.constructor )

Constructs a new storage buffer attribute.

**count**

The item count. It is also valid to pass a typed array as an argument. The subsequent parameters are then obsolete.

**itemSize**

The item size.

**typeClass**

A typed array constructor.

Default is `Float32Array`.

## Properties

### .isStorageBufferAttribute : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[src/renderers/common/StorageBufferAttribute.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/renderers/common/StorageBufferAttribute.js)
