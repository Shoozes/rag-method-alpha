*Inheritance: EventDispatcher → Node → TempNode →*

# ToneMappingNode

This node represents a tone mapping operation.

## Constructor

### new ToneMappingNode( toneMapping : number, exposureNode : Node, colorNode : Node )

Constructs a new tone mapping node.

**toneMapping**

The tone mapping type.

**exposureNode**

The tone mapping exposure.

**colorNode**

The color node to process.

Default is `null`.

## Properties

### .colorNode : Node

Represents the color to process.

Default is `null`.

### .exposureNode : Node

The tone mapping exposure.

Default is `null`.

## Methods

### .customCacheKey() : number

Overwrites the default `customCacheKey()` implementation by including the tone mapping type into the cache key.

**Overrides:** [TempNode#customCacheKey](TempNode.md#customCacheKey)

**Returns:** The hash.

### .getToneMapping() : number

Gets the tone mapping type.

**Returns:** The tone mapping type.

### .setToneMapping( value : number ) : ToneMappingNode

Sets the tone mapping type.

**value**

The tone mapping type.

**Returns:** A reference to this node.

## Source

[src/nodes/display/ToneMappingNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/display/ToneMappingNode.js)
