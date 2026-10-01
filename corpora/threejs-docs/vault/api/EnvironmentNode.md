*Inheritance: EventDispatcher → Node → LightingNode →*

# EnvironmentNode

Represents a physical model for Image-based lighting (IBL). The environment is defined via environment maps in the equirectangular, cube map or cubeUV (PMREM) format. `EnvironmentNode` is intended for PBR materials like [MeshStandardNodeMaterial](MeshStandardNodeMaterial.md).

## Constructor

### new EnvironmentNode( envNode : Node )

Constructs a new environment node.

**envNode**

A node representing the environment.

Default is `null`.

## Properties

### .envNode : Node

A node representing the environment.

Default is `null`.

## Source

[src/nodes/lighting/EnvironmentNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/EnvironmentNode.js)
