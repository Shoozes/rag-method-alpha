*Inheritance: EventDispatcher → Node → TempNode →*

# BumpMapNode

This class can be used for applying bump maps to materials.

## Code Example

```js
material.normalNode = bumpMap( texture( bumpTex ) );
```

## Constructor

### new BumpMapNode( textureNode : Node.<float>, scaleNode : Node.<float> )

Constructs a new bump map node.

**textureNode**

Represents the bump map data.

**scaleNode**

Controls the intensity of the bump effect.

Default is `null`.

## Properties

### .scaleNode : Node.<float>

Controls the intensity of the bump effect.

Default is `null`.

### .textureNode : Node.<float>

Represents the bump map data.

## Source

[src/nodes/display/BumpMapNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/display/BumpMapNode.js)
