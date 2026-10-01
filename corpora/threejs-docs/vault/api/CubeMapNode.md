*Inheritance: EventDispatcher → Node → TempNode →*

# CubeMapNode

This node can be used to automatically convert environment maps in the equirectangular format into the cube map format.

## Constructor

### new CubeMapNode( envNode : Node )

Constructs a new cube map node.

**envNode**

The node representing the environment map.

## Properties

### .envNode : Node

The node representing the environment map.

### .updateBeforeType : string

The `updateBeforeType` is set to `NodeUpdateType.RENDER` since the node updates the texture once per render in its [CubeMapNode#updateBefore](CubeMapNode.md#updateBefore) method.

Default is `'render'`.

**Overrides:** [TempNode#updateBeforeType](TempNode.md#updateBeforeType)

## Source

[src/nodes/utils/CubeMapNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/utils/CubeMapNode.js)
