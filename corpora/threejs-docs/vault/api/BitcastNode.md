*Inheritance: EventDispatcher → Node → TempNode →*

# BitcastNode

This node represents an operation that reinterprets the bit representation of a value in one type as a value in another type.

## Constructor

### new BitcastNode( valueNode : Node, conversionType : string, inputType : string )

Constructs a new bitcast node.

**valueNode**

The value to convert.

**conversionType**

The type to convert to.

**inputType**

The expected input data type of the bitcast operation.

Default is `null`.

## Properties

### .conversionType : string

The type the value will be converted to.

### .inputType : string

The expected input data type of the bitcast operation.

Default is `null`.

### .isBitcastNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .valueNode : Node

The data to bitcast to a new type.

## Source

[src/nodes/math/BitcastNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/math/BitcastNode.js)
