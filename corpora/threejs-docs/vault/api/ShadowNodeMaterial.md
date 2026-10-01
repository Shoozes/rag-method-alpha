*Inheritance: EventDispatcher → Material → NodeMaterial →*

# ShadowNodeMaterial

Node material version of [ShadowMaterial](ShadowMaterial.md).

## Constructor

### new ShadowNodeMaterial( parameters : Object )

Constructs a new shadow node material.

**parameters**

The configuration parameter.

## Properties

### .isShadowNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .lights : boolean

Set to `true` because so it's possible to implement the shadow mask effect.

Default is `true`.

**Overrides:** [NodeMaterial#lights](NodeMaterial.md#lights)

### .transparent : boolean

Overwritten since shadow materials are transparent by default.

Default is `true`.

**Overrides:** [NodeMaterial#transparent](NodeMaterial.md#transparent)

## Methods

### .setupLightingModel() : ShadowMaskModel

Setups the lighting model.

**Overrides:** [NodeMaterial#setupLightingModel](NodeMaterial.md#setupLightingModel)

**Returns:** The lighting model.

## Source

[src/materials/nodes/ShadowNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/ShadowNodeMaterial.js)
