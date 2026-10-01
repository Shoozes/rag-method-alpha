# Texture

Textures provide image data for surface colors, normal maps, roughness, height displacement, environment reflections, and lookup tables on the GPU.

In TSL, `texture( map, uv? )` samples a 2D texture with automatic filtering, mipmapping, and coordinate transformation.

<code name="textureExample" default="true">Animated Texture</code>

### Functions

::: api texture( value, uv? ) : vec4 - Samples a 2D texture with custom UV coordinates.
- **value**: `Texture | Node` - The Three.js texture instance or an existing texture node.
- **uv**: `vec2` - (Optional) Texture coordinate node to sample with. Defaults to `uv()`.
:::

::: api cubeTexture( value, uv? ) : vec4 - Samples a cube texture with a 3D direction vector.
- **value**: `CubeTexture | Node` - The cube texture instance.
- **uv**: `vec3` - (Optional) 3D sample direction vector. Defaults to `reflectVector`.
:::

::: api texture3D( value, uv? ) : vec4 - Samples a 3D volumetric texture.
- **value**: `Data3DTexture` - The 3D data texture instance.
- **uv**: `vec3` - (Optional) 3D coordinate vector.
:::

::: api textureLoad( value, uv? ) : vec4 - Fetches texel values directly from pixel coordinates without filtering or interpolation.
- **value**: `Texture | Node` - The texture instance or node.
- **uv**: `ivec2 | vec2` - (Optional) Integer or normalized pixel coordinates.
:::

::: api textureSize( texture, level? ) : uvec2 - Returns the width and height dimensions of a texture at a specified mip level.
- **texture**: `Texture | Node` - The texture whose dimensions to query.
- **level**: `int` - (Optional) The mip level to query. Defaults to `0`.
:::

::: api sampler( value ) : Node - Converts a texture into a GPU sampler.
- **value**: `Texture | Node` - The texture instance or node.
:::

### Methods

::: api .uv( uvNode: vec2 ) : Node - Returns a sample of the texture using new UV coordinates. :::

::: api .level( levelNode: int ) : Node - Explicitly selects the mipmap level for sampling. :::

::: api .bias( biasNode: float ) : Node - Applies a level-of-detail bias to mipmap selection. :::

::: api .size( level?: int ) : uvec2 - Returns the dimensions of the texture at the specified mip level. :::

::: api .sample( uvNode: vec2 ) : vec4 - Samples the texture with filtering at the given UV coordinates. :::

::: api .load( uvNode: ivec2 ) : vec4 - Loads the texel at the given pixel coordinates without filtering. :::

```tsl textureExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { texture, uv, vec2, time } from 'three/tsl';

// 1. Load a texture map
const loader = new THREE.TextureLoader();
const map = loader.load( '../examples/textures/uv_grid_opengl.jpg' );
map.wrapS = THREE.RepeatWrapping;
map.wrapT = THREE.RepeatWrapping;

// 2. Create an animated texture node with tiling and panning UVs
const animatedUV = uv().mul( 3.0 ).add( vec2( time.mul( 0.05 ), 0.0 ) );
const mapNode = texture( map, animatedUV );

// 3. Composite texture color with roughness modulation
model.material.colorNode = mapNode.rgb;
```

> IA: Avoid using `textureNode.uv( uv() )` to sample a texture with different coordinates; use `textureNode.sample( uv() )` instead. Calling `.uv()` mutates the texture node's UV property, whereas `.sample( customUV )` performs a dedicated sample operation at the given coordinates.
