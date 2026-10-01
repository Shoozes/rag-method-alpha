*Inheritance: EventDispatcher → Node → ArrayElementNode →*

# ReferenceElementNode

This class is only relevant if the referenced property is array-like. In this case, `ReferenceElementNode` allows to refer to a specific element inside the data structure via an index.

## Constructor

### new ReferenceElementNode( referenceNode : ReferenceBaseNode | ReferenceNode, indexNode : Node )

Constructs a new reference element node.

**referenceNode**

The reference node.

**indexNode**

The index node that defines the element access.

## Properties

### .isReferenceElementNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .referenceNode : ReferenceBaseNode | ReferenceNode

Similar to [ReferenceNode#reference](ReferenceNode.md#reference), an additional property references to the current node.

Default is `null`.

## Methods

### .generateNodeType() : string

This method is overwritten since the node type is inferred from the uniform type of the reference node.

**Overrides:** [ArrayElementNode#generateNodeType](ArrayElementNode.md#generateNodeType)

**Returns:** The node type.

## Source

[src/nodes/accessors/ReferenceElementNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/accessors/ReferenceElementNode.js)
