*Inheritance: EventDispatcher → Material → ShaderMaterial →*

# RawShaderMaterial

This class works just like [ShaderMaterial](ShaderMaterial.md), except that definitions of built-in uniforms and attributes are not automatically prepended to the GLSL shader code.

`RawShaderMaterial` can only be used with [WebGLRenderer](WebGLRenderer.md).

## Constructor

### new RawShaderMaterial( parameters : Object )

Constructs a new raw shader material.

**parameters**

An object with one or more properties defining the material's appearance. Any property of the material (including any property from inherited materials) can be passed in here. Color values can be passed any type of value accepted by [Color#set](Color.md#set).

## Properties

### .isRawShaderMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[src/materials/RawShaderMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/RawShaderMaterial.js)
