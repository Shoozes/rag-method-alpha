*Inheritance: EventDispatcher → Node → LightingNode → AnalyticLightNode → SpotLightNode →*

# ProjectorLightNode

An implementation of a projector light node.

## Constructor

### new ProjectorLightNode()

## Methods

### .getSpotAttenuation( builder : NodeBuilder ) : Node.<float>

Overwrites the default implementation to compute projection attenuation.

**builder**

The node builder.

**Overrides:** [SpotLightNode#getSpotAttenuation](SpotLightNode.md#getSpotAttenuation)

**Returns:** The spot attenuation.

## Source

[src/nodes/lighting/ProjectorLightNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/ProjectorLightNode.js)
