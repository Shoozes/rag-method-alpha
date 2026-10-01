*Inheritance: EventDispatcher → Material → NodeMaterial → MeshStandardNodeMaterial → MeshPhysicalNodeMaterial →*

# MeshSSSNodeMaterial

This node material is an experimental extension of [MeshPhysicalNodeMaterial](MeshPhysicalNodeMaterial.md) that implements a Subsurface scattering (SSS) term.

## Constructor

### new MeshSSSNodeMaterial( parameters : Object )

Constructs a new mesh SSS node material.

**parameters**

The configuration parameter.

## Properties

### .thicknessAmbientNode : Node.<float>

Represents the thickness ambient factor.

### .thicknessAttenuationNode : Node.<float>

Represents the thickness attenuation.

### .thicknessColorNode : Node.<vec3>

Represents the thickness color.

Default is `null`.

### .thicknessDistortionNode : Node.<float>

Represents the distortion factor.

### .thicknessPowerNode : Node.<float>

Represents the thickness power.

### .thicknessScaleNode : Node.<float>

Represents the thickness scale.

### .useSSS : boolean

Whether the lighting model should use SSS or not.

Default is `true`.

## Methods

### .setupLightingModel() : SSSLightingModel

Setups the lighting model.

**Overrides:** [MeshPhysicalNodeMaterial#setupLightingModel](MeshPhysicalNodeMaterial.md#setupLightingModel)

**Returns:** The lighting model.

## Source

[src/materials/nodes/MeshSSSNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/MeshSSSNodeMaterial.js)
