*Inheritance: EventDispatcher → Node → LightingNode → AnalyticLightNode →*

# PointLightNode

Module for representing point lights as nodes.

## Constructor

### new PointLightNode( light : PointLight )

Constructs a new point light node.

**light**

The point light source.

Default is `null`.

## Properties

### .cutoffDistanceNode : UniformNode.<float>

Uniform node representing the cutoff distance.

### .decayExponentNode : UniformNode.<float>

Uniform node representing the decay exponent.

## Methods

### .setupShadowNode() : PointShadowNode

Overwritten to setup point light specific shadow.

**Overrides:** [AnalyticLightNode#setupShadowNode](AnalyticLightNode.md#setupShadowNode)

### .update( frame : NodeFrame )

Overwritten to updated point light specific uniforms.

**frame**

A reference to the current node frame.

**Overrides:** [AnalyticLightNode#update](AnalyticLightNode.md#update)

## Source

[src/nodes/lighting/PointLightNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/PointLightNode.js)
