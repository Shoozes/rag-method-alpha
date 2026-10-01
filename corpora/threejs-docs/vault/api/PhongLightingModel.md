*Inheritance: LightingModel → BasicLightingModel →*

# PhongLightingModel

Represents the lighting model for a phong material. Used in [MeshPhongNodeMaterial](MeshPhongNodeMaterial.md).

## Constructor

### new PhongLightingModel( specular : boolean )

Constructs a new phong lighting model.

**specular**

Whether specular is supported or not.

Default is `true`.

## Properties

### .specular : boolean

Whether specular is supported or not. Set this to `false` if you are looking for a Lambert-like material meaning a material for non-shiny surfaces, without specular highlights.

Default is `true`.

## Methods

### .direct( lightData : Object )

Implements the direct lighting. The specular portion is optional and can be controlled with the [PhongLightingModel#specular](PhongLightingModel.md#specular) flag.

**lightData**

The light data.

**Overrides:** [BasicLightingModel#direct](BasicLightingModel.md#direct)

### .indirect( builder : NodeBuilder )

Implements the indirect lighting.

**builder**

The current node builder.

**Overrides:** [BasicLightingModel#indirect](BasicLightingModel.md#indirect)

## Source

[src/nodes/functions/PhongLightingModel.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/functions/PhongLightingModel.js)
