# Blend Modes

Functions for blending colors and layers together using standard blend mode algorithms.

<code name="blendModesExample" default="true">Blend Modes Showcase</code>

::: api blendColor( base, blend ) : vec4 - Blends two colors based on their alpha values by replicating normal alpha blending.
- **base**: `vec4` - The base color (non-premultiplied alpha).
- **blend**: `vec4` - The blend color (non-premultiplied alpha).
:::

::: api blendScreen( base, blend ) : vec3 - Lightens the base layer's colors based on the color of the blend layer.
- **base**: `vec3` - The base color.
- **blend**: `vec3` - The blend color. A black `#000000` blend color does not alter the base color.
:::

::: api blendOverlay( base, blend ) : vec3 - Increases contrast of the base layer by combining Multiply and Screen blend modes based on base lightness.
- **base**: `vec3` - The base color.
- **blend**: `vec3` - The blend color.
:::

::: api blendDodge( base, blend ) : vec3 - Significantly increases brightness and contrast of the base layer based on the blend layer.
- **base**: `vec3` - The base color.
- **blend**: `vec3` - The blend color. A black `#000000` blend color does not alter the base color.
:::

::: api blendBurn( base, blend ) : vec3 - Darkens the base layer's colors and increases contrast based on the blend layer.
- **base**: `vec3` - The base color.
- **blend**: `vec3` - The blend color. A white `#ffffff` blend color does not alter the base color.
:::

```tsl blendModesExample
import 'scenes/shaderball';
import { screenUV, normalWorld, vec3, float, sin, step, mix, blendScreen, blendOverlay, blendDodge, blendBurn } from 'three/tsl';

// Set vibrant normal vectors as the material color for the 3D ShaderBall
model.material.colorNode = normalWorld;

// Split screen showing 5 columns side by side on defaultPass:
// 1. Gradient (colorful vertical gradient blend layer)
// 2. Screen (lightens scene with gradient)
// 3. Overlay (enhances contrast)
// 4. Dodge (brightens highlights)
// 5. Burn (darkens shadows)

// Get screen coordinates for panel division
const u = screenUV;

// Base 3D scene render
const base = defaultPass.rgb;

// Import sin for smooth color wave spectrum
// Define a smooth, vibrant multi-color vertical spectrum gradient
const t = u.y.mul( 5.0 );
const r = sin( t ).mul( 0.5 ).add( 0.5 );
const g = sin( t.add( 2.094 ) ).mul( 0.5 ).add( 0.5 );
const b = sin( t.add( 4.188 ) ).mul( 0.5 ).add( 0.5 );
const blendLayer = vec3( r, g, b ).pow( 0.85 ).mul( 1.2 );

// Column 0: Gradient (unblended colorful gradient layer)
const col0 = blendLayer;

// Column 1: Screen (lightens base with gradient)
const col1 = blendScreen( base, blendLayer.mul( 0.6 ) );

// Column 2: Overlay (enhances contrast)
const col2 = blendOverlay( base, blendLayer );

// Column 3: Dodge (brightens highlights)
const col3 = blendDodge( base, blendLayer.mul( 0.6 ) );

// Column 4: Burn (darkens shadows)
const col4 = blendBurn( base, blendLayer );

// Combine 5 vertical columns across screen X (0.0 to 1.0)
let panelColor = col0;
panelColor = mix( panelColor, col1, step( 0.2, u.x ) );
panelColor = mix( panelColor, col2, step( 0.4, u.x ) );
panelColor = mix( panelColor, col3, step( 0.6, u.x ) );
panelColor = mix( panelColor, col4, step( 0.8, u.x ) );

// Sleek dark vertical grid lines between columns
const numColumns = float( 5.0 );
const lineCoord = u.x.mul( numColumns ).fract();
const divider = step( 0.97, lineCoord );
const finalColor = mix( panelColor, vec3( 0.0 ), divider.mul( 0.6 ) );

// Assign the split-screen post-processing result to renderPipeline
renderPipeline.outputNode = finalColor;
```
