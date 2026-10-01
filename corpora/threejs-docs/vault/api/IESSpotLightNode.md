*Inheritance: EventDispatcher → Node → LightingNode → AnalyticLightNode → SpotLightNode →*

# IESSpotLightNode

An IES version of the default spot light node.

## Constructor

### new IESSpotLightNode( light : SpotLight )

Constructs a new IES spot light node.

**light**

The spot light source.

Default is `null`.

## Properties

### ._iesTextureNode : TextureNode

The texture node representing the IES texture.

Default is `null`.

## Methods

### .getSpotAttenuation( builder : NodeBuilder, angleCosine : Node.<float> ) : Node.<float>

Overwrites the default implementation to compute an IES conform spot attenuation.

**builder**

The node builder.

**angleCosine**

The angle to compute the spot attenuation for.

**Overrides:** [SpotLightNode#getSpotAttenuation](SpotLightNode.md#getSpotAttenuation)

**Returns:** The spot attenuation.

### .update( frame : NodeFrame )

Overwritten to update the IES spot light texture.

**frame**

A reference to the current node frame.

**Overrides:** [SpotLightNode#update](SpotLightNode.md#update)

## Source

[src/nodes/lighting/IESSpotLightNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/IESSpotLightNode.js)
