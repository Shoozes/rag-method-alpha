*Inheritance: EventDispatcher → Material → NodeMaterial →*

# MeshStandardNodeMaterial

Node material version of [MeshStandardMaterial](MeshStandardMaterial.md).

## Constructor

### new MeshStandardNodeMaterial( parameters : Object )

Constructs a new mesh standard node material.

**parameters**

The configuration parameter.

## Properties

### .emissiveNode : Node.<vec3>

The emissive color of standard materials is by default inferred from the `emissive`, `emissiveIntensity` and `emissiveMap` properties. This node property allows to overwrite the default and define the emissive color with a node instead.

If you don't want to overwrite the emissive color but modify the existing value instead, use [materialEmissive](TSL.md#materialEmissive).

Default is `null`.

### .isMeshStandardNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .lights : boolean

Set to `true` because standard materials react on lights.

Default is `true`.

**Overrides:** [NodeMaterial#lights](NodeMaterial.md#lights)

### .metalnessNode : Node.<float>

The metalness of standard materials is by default inferred from the `metalness`, and `metalnessMap` properties. This node property allows to overwrite the default and define the metalness with a node instead.

If you don't want to overwrite the metalness but modify the existing value instead, use [materialMetalness](TSL.md#materialMetalness).

Default is `null`.

### .roughnessNode : Node.<float>

The roughness of standard materials is by default inferred from the `roughness`, and `roughnessMap` properties. This node property allows to overwrite the default and define the roughness with a node instead.

If you don't want to overwrite the roughness but modify the existing value instead, use [materialRoughness](TSL.md#materialRoughness).

Default is `null`.

## Methods

### .setupEnvironment( builder : NodeBuilder ) : EnvironmentNode.<vec3>

Overwritten since this type of material uses [EnvironmentNode](EnvironmentNode.md) to implement the PBR (PMREM based) environment mapping. Besides, the method honors `Scene.environment`.

**builder**

The current node builder.

**Overrides:** [NodeMaterial#setupEnvironment](NodeMaterial.md#setupEnvironment)

**Returns:** The environment node.

### .setupLightingModel() : PhysicalLightingModel

Setups the lighting model.

**Overrides:** [NodeMaterial#setupLightingModel](NodeMaterial.md#setupLightingModel)

**Returns:** The lighting model.

### .setupSpecular()

Setups the specular related node variables.

### .setupVariants( builder : NodeBuilder )

Setups the standard specific node variables.

**builder**

The current node builder.

**Overrides:** [NodeMaterial#setupVariants](NodeMaterial.md#setupVariants)

## Source

[src/materials/nodes/MeshStandardNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/MeshStandardNodeMaterial.js)
