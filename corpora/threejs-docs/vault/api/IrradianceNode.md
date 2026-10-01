*Inheritance: EventDispatcher → Node → LightingNode →*

# IrradianceNode

A generic class that can be used by nodes which contribute irradiance to the scene. E.g. a light map node can be used as input for this module. Used in [NodeMaterial](NodeMaterial.md).

## Constructor

### new IrradianceNode( node : Node.<vec3> )

Constructs a new irradiance node.

**node**

A node contributing irradiance.

## Properties

### .node : Node.<vec3>

A node contributing irradiance.

## Source

[src/nodes/lighting/IrradianceNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/IrradianceNode.js)
