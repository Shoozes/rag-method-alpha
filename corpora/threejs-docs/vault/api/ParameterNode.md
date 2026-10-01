*Inheritance: EventDispatcher → Node → PropertyNode →*

# ParameterNode

Special version of [PropertyNode](PropertyNode.md) which is used for parameters.

## Constructor

### new ParameterNode( nodeType : string, name : string )

Constructs a new parameter node.

**nodeType**

The type of the node.

**name**

The name of the parameter in the shader.

Default is `null`.

## Properties

### .isParameterNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Methods

### .getMemberType( builder : NodeBuilder, name : string ) : string

Gets the type of a member variable in the parameter node.

**builder**

The node builder.

**name**

The name of the member variable.

**Overrides:** [PropertyNode#getMemberType](PropertyNode.md#getMemberType)

## Source

[src/nodes/core/ParameterNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/core/ParameterNode.js)
