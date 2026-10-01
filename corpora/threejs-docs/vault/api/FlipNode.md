*Inheritance: EventDispatcher → Node → TempNode →*

# FlipNode

This module is part of the TSL core and usually not used in app level code. It represents a flip operation during the shader generation process meaning it flips normalized values with the following formula:

```js
x = 1 - x;
```

`FlipNode` is internally used to implement any `flipXYZW()`, `flipRGBA()` and `flipSTPQ()` method invocations on node objects. For example:

```js
uvNode = uvNode.flipY();
```

## Constructor

### new FlipNode( sourceNode : Node, components : string )

Constructs a new flip node.

**sourceNode**

The node which component(s) should be flipped.

**components**

The components that should be flipped e.g. `'x'` or `'xy'`.

## Properties

### .components : string

The components that should be flipped e.g. `'x'` or `'xy'`.

### .sourceNode : Node

The node which component(s) should be flipped.

## Methods

### .generateNodeType( builder : NodeBuilder ) : string

This method is overwritten since the node type is inferred from the source node.

**builder**

The current node builder.

**Overrides:** [TempNode#generateNodeType](TempNode.md#generateNodeType)

**Returns:** The node type.

## Source

[src/nodes/utils/FlipNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/utils/FlipNode.js)
