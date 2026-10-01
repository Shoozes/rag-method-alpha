# Remap

Remapping functions are used to convert values from an input range to a custom output range. This is incredibly useful for normalizing arbitrary data ranges (e.g. noise values, coordinates, or angles) into suitable inputs for color mixing, opacity envelopes, or procedural sizing factors.

<code name="remapExample" default="true">Remap Visualizer</code>

::: api remap( node, inLow, inHigh, outLow?, outHigh? ) : Node - Remaps a value from one range to another.
- **node**: `Node` - The input value to remap.
- **inLow**: `Node | float` - The lower bound of the input range.
- **inHigh**: `Node | float` - The upper bound of the input range.
- **outLow**: `Node | float` - The lower bound of the target output range. Defaults to `float( 0 )`.
- **outHigh**: `Node | float` - The upper bound of the target output range. Defaults to `float( 1 )`.
:::

::: api remapClamp( node, inLow, inHigh, outLow?, outHigh? ) : Node - Remaps a value from one range to another, with clamping.
- **node**: `Node` - The input value to remap.
- **inLow**: `Node | float` - The lower bound of the input range.
- **inHigh**: `Node | float` - The upper bound of the input range.
- **outLow**: `Node | float` - The lower bound of the target output range. Defaults to `float( 0 )`.
- **outHigh**: `Node | float` - The upper bound of the target output range. Defaults to `float( 1 )`.
:::

```tsl remapExample
import 'scenes/empty';
import { screenUV, color, float, mix, smoothstep, remap, remapClamp } from 'three/tsl';

// This example compares remapping methods across three horizontal bands:
// - Top: Original gradient (x coordinate from 0.0 to 1.0).
// - Middle: Unclamped remap. The gradient naturally extrapolates outside the input range.
// - Bottom: Clamped remap. The gradient cleanly clamps at the input boundaries.

// Define the remapping input range boundaries [0.2, 0.8]
const inLow = float( 0.2 );
const inHigh = float( 0.8 );

// Base gradient colors matching the theme: dark grey to accent blue
const colorStart = color( 0x222222 );
const colorEnd = color( 0x00aaff );

// Track 1: Original gradient (top 1/3)
const valOriginal = screenUV.x;
const colorOriginal = mix( colorStart, colorEnd, valOriginal );

// Track 2: Unclamped remap (middle 1/3)
const valRemap = remap( screenUV.x, inLow, inHigh, float( 0.0 ), float( 1.0 ) );
// Underflow and overflow naturally extrapolate outside [0.0, 1.0] range
const colorRemap = mix( colorStart, colorEnd, valRemap );

// Track 3: Clamped remap (bottom 1/3)
const valRemapClamp = remapClamp( screenUV.x, inLow, inHigh, float( 0.0 ), float( 1.0 ) );
// Underflow is clamped to 0.0 (colorStart), and overflow is clamped to 1.0 (colorEnd)
const colorRemapClamp = mix( colorStart, colorEnd, valRemapClamp );

// Segment the screen vertically into the three tracks (Original on top, Clamped at the bottom)
// Due to screen Y-coordinate mapping, Y < 0.33 is the top track, and Y >= 0.66 is the bottom track
const screenColor = screenUV.y.lessThan( 0.33 ).select(
	colorOriginal,
	screenUV.y.lessThan( 0.66 ).select( colorRemap, colorRemapClamp )
);

// Draw black horizontal dividers between the tracks
const divider1 = smoothstep( 0.0, 0.004, screenUV.y.sub( 0.33 ).abs() ).oneMinus();
const divider2 = smoothstep( 0.0, 0.004, screenUV.y.sub( 0.66 ).abs() ).oneMinus();
const dividers = divider1.add( divider2 );

// Composite dividers on top of the tracks
const finalColor = mix( screenColor, color( 0x000000 ), dividers );

renderPipeline.outputNode = finalColor;
```
