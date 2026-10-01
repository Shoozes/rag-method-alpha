*Inheritance: EventDispatcher → Node → ShadowBaseNode → ShadowNode →*

# PointShadowNode

Represents the shadow implementation for point light nodes.

## Constructor

### new PointShadowNode( light : PointLight, shadow : PointLightShadow )

Constructs a new point shadow node.

**light**

The shadow casting point light.

**shadow**

An optional point light shadow.

Default is `null`.

## Methods

### .getShadowFilterFn( type : number ) : function

Overwrites the default implementation to return point light shadow specific filtering functions.

**type**

The shadow type.

**Overrides:** [ShadowNode#getShadowFilterFn](ShadowNode.md#getShadowFilterFn)

**Returns:** The filtering function.

### .renderShadow( frame : NodeFrame )

Overwrites the default implementation with point light specific rendering code.

**frame**

A reference to the current node frame.

**Overrides:** [ShadowNode#renderShadow](ShadowNode.md#renderShadow)

### .setupRenderTarget( shadow : LightShadow, builder : NodeBuilder ) : Object

Overwrites the default implementation to create a CubeRenderTarget with CubeDepthTexture.

**shadow**

The light shadow object.

**builder**

A reference to the current node builder.

**Returns:** An object containing the shadow map and depth texture.

### .setupShadowCoord( builder : NodeBuilder, shadowPosition : Node.<vec3> ) : Node.<vec3>

Overwrites the default implementation so the unaltered shadow position is used.

**builder**

A reference to the current node builder.

**shadowPosition**

A node representing the shadow position.

**Overrides:** [ShadowNode#setupShadowCoord](ShadowNode.md#setupShadowCoord)

**Returns:** The shadow coordinates.

### .setupShadowFilter( builder : NodeBuilder, inputs : Object ) : Node.<float>

Overwrites the default implementation to only use point light specific shadow filter functions.

**builder**

A reference to the current node builder.

**inputs**

A configuration object that defines the shadow filtering.

**filterFn**

This function defines the filtering type of the shadow map e.g. PCF.

**depthTexture**

A reference to the shadow map's depth texture.

**shadowCoord**

Shadow coordinates which are used to sample from the shadow map.

**shadow**

The light shadow.

**Overrides:** [ShadowNode#setupShadowFilter](ShadowNode.md#setupShadowFilter)

**Returns:** The result node of the shadow filtering.

## Source

[src/nodes/lighting/PointShadowNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/lighting/PointShadowNode.js)
