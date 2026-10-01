*Inheritance: EventDispatcher → Node → TempNode → MathNode →*

# BitcountNode

This node represents an operation that counts the bits of a piece of shader data.

## Constructor

### new BitcountNode( method : 'countTrailingZeros' | 'countLeadingZeros' | 'countOneBits', aNode : Node )

Constructs a new math node.

**method**

The method name.

**aNode**

The first input.

## Properties

### .isBitcountNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[src/nodes/math/BitcountNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/math/BitcountNode.js)
