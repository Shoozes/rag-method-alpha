*Inheritance: EventDispatcher → Node → LightingNode → AnalyticLightNode →*

# LightProbeNode

Module for representing light probes as nodes.

## Constructor

### new LightProbeNode( light : LightProbe )

Constructs a new light probe node.

**light**

The light probe.

Default is `null`.

## Properties

### .lightProbe : UniformArrayNode

Light probe represented as a uniform of spherical harmonics.

## Methods

### .update( frame : NodeFrame )

Overwritten to updated light probe specific uniforms.

**frame**

A reference to the current node frame.

**Overrides:** [AnalyticLightNode#update](AnalyticLightNode.md#update)

## Source

[src/nodes/lighting/LightProbeNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/LightProbeNode.js)
