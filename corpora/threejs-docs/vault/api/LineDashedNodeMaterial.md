*Inheritance: EventDispatcher → Material → NodeMaterial →*

# LineDashedNodeMaterial

Node material version of [LineDashedMaterial](LineDashedMaterial.md).

## Constructor

### new LineDashedNodeMaterial( parameters : Object )

Constructs a new line dashed node material.

**parameters**

The configuration parameter.

## Properties

### .dashOffset : number

The dash offset.

Default is `0`.

### .dashScaleNode : Node.<float>

The scale of dash materials is by default inferred from the `scale` property. This node property allows to overwrite the default and define the scale with a node instead.

If you don't want to overwrite the scale but modify the existing value instead, use [materialLineScale](TSL.md#materialLineScale).

Default is `null`.

### .dashSizeNode : Node.<float>

The dash size of dash materials is by default inferred from the `dashSize` property. This node property allows to overwrite the default and define the dash size with a node instead.

If you don't want to overwrite the dash size but modify the existing value instead, use [materialLineDashSize](TSL.md#materialLineDashSize).

Default is `null`.

### .gapSizeNode : Node.<float>

The gap size of dash materials is by default inferred from the `gapSize` property. This node property allows to overwrite the default and define the gap size with a node instead.

If you don't want to overwrite the gap size but modify the existing value instead, use [materialLineGapSize](TSL.md#materialLineGapSize).

Default is `null`.

### .isLineDashedNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .offsetNode : Node.<float>

The offset of dash materials is by default inferred from the `dashOffset` property. This node property allows to overwrite the default and define the offset with a node instead.

If you don't want to overwrite the offset but modify the existing value instead, use [materialLineDashOffset](TSL.md#materialLineDashOffset).

Default is `null`.

## Methods

### .setupVariants( builder : NodeBuilder )

Setups the dash specific node variables.

**builder**

The current node builder.

**Overrides:** [NodeMaterial#setupVariants](NodeMaterial.md#setupVariants)

## Source

[src/materials/nodes/LineDashedNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/LineDashedNodeMaterial.js)
