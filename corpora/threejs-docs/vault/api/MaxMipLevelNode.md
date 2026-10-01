*Inheritance: EventDispatcher → Node → InputNode → UniformNode →*

# MaxMipLevelNode

A special type of uniform node that computes the maximum mipmap level for a given texture node.

## Code Example

```js
const level = maxMipLevel( textureNode );
```

## Constructor

### new MaxMipLevelNode( textureNode : TextureNode )

Constructs a new max mip level node.

**textureNode**

The texture node to compute the max mip level for.

## Properties

### .texture : Texture (readonly)

The texture.

### .textureNode : TextureNode (readonly)

The texture node to compute the max mip level for.

### .updateType : string

The `updateType` is set to `NodeUpdateType.FRAME` since the node updates the texture once per frame in its [MaxMipLevelNode#update](MaxMipLevelNode.md#update) method.

Default is `'frame'`.

**Overrides:** [UniformNode#updateType](UniformNode.md#updateType)

## Source

[src/nodes/utils/MaxMipLevelNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/utils/MaxMipLevelNode.js)
