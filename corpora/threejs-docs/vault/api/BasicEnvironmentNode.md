*Inheritance: EventDispatcher → Node → LightingNode →*

# BasicEnvironmentNode

Represents a basic model for Image-based lighting (IBL). The environment is defined via environment maps in the equirectangular or cube map format. `BasicEnvironmentNode` is intended for non-PBR materials like [MeshBasicNodeMaterial](MeshBasicNodeMaterial.md) or [MeshPhongNodeMaterial](MeshPhongNodeMaterial.md).

## Constructor

### new BasicEnvironmentNode( envNode : Node )

Constructs a new basic environment node.

**envNode**

A node representing the environment.

Default is `null`.

## Properties

### .envNode : Node

A node representing the environment.

Default is `null`.

## Source

[src/nodes/lighting/BasicEnvironmentNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/BasicEnvironmentNode.js)
