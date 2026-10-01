*Inheritance: LightingModel →*

# ShadowMaskModel

Represents lighting model for a shadow material. Used in [ShadowNodeMaterial](ShadowNodeMaterial.md).

## Constructor

### new ShadowMaskModel()

Constructs a new shadow mask model.

## Properties

### .shadowNode : Node

The shadow mask node.

## Methods

### .direct( input : Object )

Only used to save the shadow mask.

**input**

The input data.

**Overrides:** [LightingModel#direct](LightingModel.md#direct)

### .finish( builder : NodeBuilder )

Uses the shadow mask to produce the final color.

**builder**

The current node builder.

**Overrides:** [LightingModel#finish](LightingModel.md#finish)

## Source

[src/nodes/functions/ShadowMaskModel.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/functions/ShadowMaskModel.js)
