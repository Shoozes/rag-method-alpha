*Inheritance: EventDispatcher → Node → TempNode →*

# OperatorNode

This node represents basic mathematical and logical operations like addition, subtraction or comparisons (e.g. `equal()`).

## Constructor

### new OperatorNode( op : string, aNode : Node, bNode : Node, …params : Node )

Constructs a new operator node.

**op**

The operator.

**aNode**

The first input.

**bNode**

The second input.

**params**

Additional input parameters.

## Properties

### .aNode : Node

The first input.

### .bNode : Node

The second input.

### .isOperatorNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .op : string

The operator.

## Methods

### .generateNodeType( builder : NodeBuilder, output : string ) : string

This method is overwritten since the node type is inferred from the operator and the input node types.

**builder**

The current node builder.

**output**

The output type.

Default is `null`.

**Overrides:** [TempNode#generateNodeType](TempNode.md#generateNodeType)

**Returns:** The node type.

### .getOperatorMethod( builder : NodeBuilder, output : string ) : string

Returns the operator method name.

**builder**

The current node builder.

**output**

The output type.

**Returns:** The operator method name.

## Source

[src/nodes/math/OperatorNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/math/OperatorNode.js)
