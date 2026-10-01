*Inheritance: EventDispatcher → Node → ArrayElementNode →*

# UniformArrayElementNode

Represents the element access on uniform array nodes.

## Constructor

### new UniformArrayElementNode( uniformArrayNode : UniformArrayNode, indexNode : IndexNode )

Constructs a new buffer node.

**uniformArrayNode**

The uniform array node to access.

**indexNode**

The index data that define the position of the accessed element in the array.

## Properties

### .isArrayBufferElementNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[src/nodes/accessors/UniformArrayNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/accessors/UniformArrayNode.js)
