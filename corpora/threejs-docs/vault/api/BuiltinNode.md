*Inheritance: EventDispatcher → Node →*

# BuiltinNode

The node allows to set values for built-in shader variables. That is required for features like hardware-accelerated vertex clipping.

## Constructor

### new BuiltinNode( name : string )

Constructs a new builtin node.

**name**

The name of the built-in shader variable.

## Properties

### .isBuiltinNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .name : string

The name of the built-in shader variable.

**Overrides:** [Node#name](Node.md#name)

## Methods

### .generate( builder : NodeBuilder ) : string

Generates the code snippet of the builtin node.

**builder**

The current node builder.

**Overrides:** [Node#generate](Node.md#generate)

**Returns:** The generated code snippet.

## Source

[src/nodes/accessors/BuiltinNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/accessors/BuiltinNode.js)
