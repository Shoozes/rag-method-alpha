*Inheritance: EventDispatcher → Node → LightingNode →*

# BasicLightMapNode

A specific version of [IrradianceNode](IrradianceNode.md) that is only relevant for [MeshBasicNodeMaterial](MeshBasicNodeMaterial.md). Since the material is unlit, it requires a special scaling factor for the light map.

## Constructor

### new BasicLightMapNode( lightMapNode : Node.<vec3> )

Constructs a new basic light map node.

**lightMapNode**

The light map node.

Default is `null`.

## Properties

### .lightMapNode : Node.<vec3>

The light map node.

## Source

[src/nodes/lighting/BasicLightMapNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/BasicLightMapNode.js)
