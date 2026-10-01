*Inheritance: NodeParser →*

# WGSLNodeParser

A WGSL node parser.

## Constructor

### new WGSLNodeParser()

## Methods

### .parseFunction( source : string ) : WGSLNodeFunction

The method parses the given WGSL code an returns a node function.

**source**

The WGSL code.

**Overrides:** [NodeParser#parseFunction](NodeParser.md#parseFunction)

**Returns:** A node function.

## Source

[src/renderers/webgpu/nodes/WGSLNodeParser.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/renderers/webgpu/nodes/WGSLNodeParser.js)
