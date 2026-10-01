*Inheritance: EventDispatcher → Node → LightingNode →*

# AONode

A generic class that can be used by nodes which contribute ambient occlusion to the scene. E.g. an ambient occlusion map node can be used as input for this module. Used in [NodeMaterial](NodeMaterial.md).

## Constructor

### new AONode( aoNode : Node.<float> )

Constructs a new AO node.

**aoNode**

The ambient occlusion node.

Default is `null`.

## Properties

### .aoNode : Node.<float>

The ambient occlusion node.

Default is `null`.

## Source

[src/nodes/lighting/AONode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/AONode.js)
