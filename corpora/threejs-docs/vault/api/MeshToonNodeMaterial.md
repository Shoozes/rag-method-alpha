*Inheritance: EventDispatcher → Material → NodeMaterial →*

# MeshToonNodeMaterial

Node material version of [MeshToonMaterial](MeshToonMaterial.md).

## Constructor

### new MeshToonNodeMaterial( parameters : Object )

Constructs a new mesh toon node material.

**parameters**

The configuration parameter.

## Properties

### .isMeshToonNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .lights : boolean

Set to `true` because toon materials react on lights.

Default is `true`.

**Overrides:** [NodeMaterial#lights](NodeMaterial.md#lights)

## Methods

### .setupLightingModel() : ToonLightingModel

Setups the lighting model.

**Overrides:** [NodeMaterial#setupLightingModel](NodeMaterial.md#setupLightingModel)

**Returns:** The lighting model.

## Source

[src/materials/nodes/MeshToonNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/MeshToonNodeMaterial.js)
