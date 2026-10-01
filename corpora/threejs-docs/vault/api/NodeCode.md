# NodeCode

[NodeBuilder](NodeBuilder.md) is going to create instances of this class during the build process of nodes. They represent user-defined, native shader code portions that are going to be injected by the builder. A dictionary of node codes is maintained in [NodeBuilder#codes](NodeBuilder.md#codes) for this purpose.

## Constructor

### new NodeCode( name : string, type : string, code : string )

Constructs a new code node.

**name**

The name of the code.

**type**

The node type.

**code**

The native shader code.

Default is `''`.

## Properties

### .code : string

The native shader code.

Default is `''`.

### .name : string

The name of the code.

### .type : string

The node type.

## Source

[src/nodes/core/NodeCode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/core/NodeCode.js)
