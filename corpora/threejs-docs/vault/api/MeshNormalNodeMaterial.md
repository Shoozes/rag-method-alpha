*Inheritance: EventDispatcher → Material → NodeMaterial →*

# MeshNormalNodeMaterial

Node material version of [MeshNormalMaterial](MeshNormalMaterial.md).

## Constructor

### new MeshNormalNodeMaterial( parameters : Object )

Constructs a new mesh normal node material.

**parameters**

The configuration parameter.

## Properties

### .isMeshNormalNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Methods

### .setupDiffuseColor()

Overwrites the default implementation by computing the diffuse color based on the normal data.

**Overrides:** [NodeMaterial#setupDiffuseColor](NodeMaterial.md#setupDiffuseColor)

## Source

[src/materials/nodes/MeshNormalNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/MeshNormalNodeMaterial.js)
