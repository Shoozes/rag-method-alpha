*Inheritance: EventDispatcher → Node → TempNode →*

# NormalMapNode

This class can be used for applying normals maps to materials.

## Code Example

```js
material.normalNode = normalMap( texture( normalTex ) );
```

## Constructor

### new NormalMapNode( node : Node.<vec3>, scaleNode : Node.<vec2> )

Constructs a new normal map node.

**node**

Represents the normal map data.

**scaleNode**

Controls the intensity of the effect.

Default is `null`.

## Properties

### .node : Node.<vec3>

Represents the normal map data.

### .normalMapType : TangentSpaceNormalMap | ObjectSpaceNormalMap

The normal map type.

Default is `TangentSpaceNormalMap`.

### .scaleNode : Node.<vec2>

Controls the intensity of the effect.

Default is `null`.

### .unpackNormalMode : string

Controls how to unpack the sampled normal map values.

Default is `NoNormalPacking`.

## Source

[src/nodes/display/NormalMapNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/display/NormalMapNode.js)
