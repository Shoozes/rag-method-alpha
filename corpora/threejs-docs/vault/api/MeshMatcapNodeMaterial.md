*Inheritance: EventDispatcher → Material → NodeMaterial →*

# MeshMatcapNodeMaterial

Node material version of [MeshMatcapMaterial](MeshMatcapMaterial.md).

## Constructor

### new MeshMatcapNodeMaterial( parameters : Object )

Constructs a new mesh normal node material.

**parameters**

The configuration parameter.

## Properties

### .isMeshMatcapNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Methods

### .setupVariants( builder : NodeBuilder )

Setups the matcap specific node variables.

**builder**

The current node builder.

**Overrides:** [NodeMaterial#setupVariants](NodeMaterial.md#setupVariants)

## Source

[src/materials/nodes/MeshMatcapNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/MeshMatcapNodeMaterial.js)
