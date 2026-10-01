# Color Adjustments

Functions for adjusting and manipulating colors.

<code name="colorAdjustmentsExample" default="true">Color Adjustments Showcase</code>

::: api grayscale( color ) - Computes a grayscale color value for the given RGB color based on luminance. Returns `vec3`.
- **color**: `vec3` - Input RGB color value.
:::

::: api luminance( color, luminanceCoefficients? ) - Calculates the luminance (perceived brightness) of an RGB color. Returns `float`.
- **color**: `vec3` - Input RGB color value.
- **luminanceCoefficients**: `vec3` - (Optional) Luminance coefficients node. Defaults to current working color space coefficients.
:::

::: api saturation( color, adjustment? ) - Adjusts the saturation of an RGB color. Returns `vec3`.
- **color**: `vec3` - Input RGB color value.
- **adjustment**: `float` - (Optional) Conversion factor. Values `< 1` desaturate, values `> 1` super-saturate. Defaults to `float( 1 )`.
:::

::: api vibrance( color, adjustment? ) - Selectively enhances the intensity of less saturated RGB colors while preserving saturated ones. Returns `vec3`.
- **color**: `vec3` - Input RGB color value.
- **adjustment**: `float` - (Optional) Intensity factor for vibrance effect. Defaults to `float( 0 )`.
:::

::: api hue( color, adjustment? ) - Rotates the hue of an RGB color while preserving its luminance and saturation. Returns `vec3`.
- **color**: `vec3` - Input RGB color value.
- **adjustment**: `float` - (Optional) Hue rotation angle in radians (positive = clockwise, negative = counterclockwise). Defaults to `float( 1 )`.
:::

::: api posterize( source, steps ) - Reduces the number of color levels, creating a poster-like effect. Returns `Node`.
- **source**: `Node` - Input color value.
- **steps**: `Node` - Number of color levels. Lower values produce a more blocky, stylized effect.
:::

::: api cdl( color, slope?, offset?, power?, saturation?, luminanceCoefficients? ) - Compact representation of ASC Color Decision List (CDL) v1.2 color grading information. Returns `vec4`.
- **color**: `vec4` - Input color (typically in a log color space such as LogC, ACEScc, or AgX Log).
- **slope**: `vec3` - (Optional) Slope adjustment multiplier for RGB channels. Defaults to `vec3( 1 )`.
- **offset**: `vec3` - (Optional) Offset adjustment added to RGB channels. Defaults to `vec3( 0 )`.
- **power**: `vec3` - (Optional) Power gamma exponent applied to RGB channels. Defaults to `vec3( 1 )`.
- **saturation**: `float` - (Optional) Overall saturation adjustment factor. Defaults to `float( 1 )`.
- **luminanceCoefficients**: `vec3` - (Optional) Luminance coefficients used for saturation calculation (defaults to Rec. 709).
:::

```tsl colorAdjustmentsExample
import 'scenes/shaderball';
import { screenUV, normalWorld, vec3, float, step, mix, hue, saturation, vibrance, posterize } from 'three/tsl';

// Set vibrant normal vectors as the material color for the 3D ShaderBall
model.material.colorNode = normalWorld;

// Split screen showing 5 color adjustments side by side on defaultPass:
// 1. Original (unadjusted base scene)
// 2. Hue (fixed hue rotation of 1.5 rad)
// 3. Saturation (desaturated to 0)
// 4. Vibrance (fixed 3.0 vibrance boost)
// 5. Posterize (fixed 4 color levels)

// Get screen coordinates for panel division
const u = screenUV;

// Column 0: Original (unadjusted base scene)
const col0 = defaultPass.rgb;

// Column 1: Hue (fixed hue rotation of 1.5 radians)
const col1 = hue( defaultPass, 1.5 );

// Column 2: Saturation (desaturated to 0)
const col2 = saturation( defaultPass, 0.0 );

// Column 3: Vibrance (fixed 3.0 vibrance boost)
const col3 = vibrance( defaultPass, 3.0 );

// Column 4: Posterize (fixed 4 color levels)
const col4 = posterize( defaultPass, 4.0 );

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
