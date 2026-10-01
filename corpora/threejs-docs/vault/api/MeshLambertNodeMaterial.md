*Inheritance: EventDispatcher → Material → NodeMaterial →*

# MeshLambertNodeMaterial

Node material version of [MeshLambertMaterial](MeshLambertMaterial.md).

## Constructor

### new MeshLambertNodeMaterial( parameters : Object )

Constructs a new mesh lambert node material.

**parameters**

The configuration parameter.

## Properties

### .isMeshLambertNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .lights : boolean

Set to `true` because lambert materials react on lights.

Default is `true`.

**Overrides:** [NodeMaterial#lights](NodeMaterial.md#lights)

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

## Source

[src/materials/nodes/MeshLambertNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/MeshLambertNodeMaterial.js)
