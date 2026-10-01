*Inheritance: EventDispatcher → Node → InputNode → UniformNode → TextureNode →*

# PassTextureNode

Represents the texture of a pass node.

## Constructor

### new PassTextureNode( passNode : PassNode, texture : Texture )

Constructs a new pass texture node.

**passNode**

The pass node.

**texture**

The output texture.

## Properties

### .isPassTextureNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .passNode : PassNode

A reference to the pass node.

## Source

[src/nodes/display/PassNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/display/PassNode.js)
