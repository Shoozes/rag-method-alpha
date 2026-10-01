*Inheritance: NodeFunction →*

# GLSLNodeFunction

This class represents a GLSL node function.

## Constructor

### new GLSLNodeFunction( source : string )

Constructs a new GLSL node function.

**source**

The GLSL source.

## Methods

### .getCode( name : string ) : string

This method returns the GLSL code of the node function.

**name**

The function's name.

Default is `this.name`.

**Overrides:** [NodeFunction#getCode](NodeFunction.md#getCode)

**Returns:** The shader code.

## Source

[src/nodes/parsers/GLSLNodeFunction.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/parsers/GLSLNodeFunction.js)
