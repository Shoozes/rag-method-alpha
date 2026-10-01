# Struct

Structs allow you to create custom data types with multiple members. They can be used to organize related data in shaders, define structures for attributes and uniforms.

::: api struct( membersLayout, name? ) : Function - Creates a struct type with the specified member layout.
- **membersLayout**: `object` - An object defining the fields and their type strings (e.g., `{ min: 'vec3', max: 'vec3' }`). Members can also be declared as objects to enable WebGPU atomic operations (e.g., `{ x: { type: 'int', atomic: true } }`).
- **name**: `string` - (Optional) The name of the struct type in the generated WGSL/GLSL shader source code. Defaults to `null`.
:::

::: api outputStruct( ...members ) : Node - Creates an output struct node for returning multiple values.
- **members**: `...Node` - The nodes to return as members of the output structure (commonly used in MRT).
:::

Example:

```js
import { struct, vec3 } from 'three/tsl';

// Define a custom struct
const BoundingBox = struct( { min: 'vec3', max: 'vec3' } );

// Create a new instance of the struct
const bb = BoundingBox( vec3( 0 ), vec3( 1 ) ); // style 1
const bb2 = BoundingBox( { min: vec3( 0 ), max: vec3( 1 ) } ); // style 2

// Access the struct members
const min = bb.get( 'min' );

// Assign a new value to a member
min.assign( vec3( - 1, - 1, - 1 ) );

// Define a custom struct with atomic fields
const Cell = struct( {
	x: { type: 'int', atomic: true },
	y: { type: 'int', atomic: true },
	mass: { type: 'int', atomic: true }
} );
```

<code name="structExample" default="true">Struct Showcase</code>

```tsl structExample
import 'scenes/shaderball';
import { struct, vec3 } from 'three/tsl';

// Define a custom struct type
const CustomColor = struct( { r: 'float', g: 'float', b: 'float' } );

// Instantiate the struct
const myColor = CustomColor( 0.1, 0.5, 0.9 );

// Retrieve the components and construct a vec3 color node
const finalColor = vec3( myColor.get( 'r' ), myColor.get( 'g' ), myColor.get( 'b' ) );

model.material.colorNode = finalColor;
```
