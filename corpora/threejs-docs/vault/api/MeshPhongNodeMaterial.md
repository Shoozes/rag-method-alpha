*Inheritance: EventDispatcher → Material → NodeMaterial →*

# MeshPhongNodeMaterial

Node material version of [MeshPhongMaterial](MeshPhongMaterial.md).

## Constructor

### new MeshPhongNodeMaterial( parameters : Object )

Constructs a new mesh lambert node material.

**parameters**

The configuration parameter.

## Properties

### .isMeshPhongNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .lights : boolean

Set to `true` because phong materials react on lights.

Default is `true`.

**Overrides:** [NodeMaterial#lights](NodeMaterial.md#lights)

### .shininessNode : Node.<float>

The shininess of phong materials is by default inferred from the `shininess` property. This node property allows to overwrite the default and define the shininess with a node instead.

If you don't want to overwrite the shininess but modify the existing value instead, use [materialShininess](TSL.md#materialShininess).

Default is `null`.

### .specularNode : Node.<vec3>

The specular color of phong materials is by default inferred from the `specular` property. This node property allows to overwrite the default and define the specular color with a node instead.

If you don't want to overwrite the specular color but modify the existing value instead, use [materialSpecular](TSL.md#materialSpecular).

Default is `null`.

## Methods

### .setupEnvironment( builder : NodeBuilder ) : BasicEnvironmentNode.<vec3>

Overwritten since this type of material uses [BasicEnvironmentNode](BasicEnvironmentNode.md) to implement the default environment mapping.

**builder**

The current node builder.

**Overrides:** [NodeMaterial#setupEnvironment](NodeMaterial.md#setupEnvironment)

**Returns:** The environment node.

### .setupLightingModel() : PhongLightingModel

Setups the lighting model.

**Overrides:** [NodeMaterial#setupLightingModel](NodeMaterial.md#setupLightingModel)

**Returns:** The lighting model.

### .setupVariants( builder : NodeBuilder )

Setups the phong specific node variables.

**builder**

The current node builder.

**Overrides:** [NodeMaterial#setupVariants](NodeMaterial.md#setupVariants)

## Source

[src/materials/nodes/MeshPhongNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/MeshPhongNodeMaterial.js)
