# Oscillator

The oscillator functions generate periodic waveforms in the range `[0, 1]` based on a timer node (which defaults to `time`). They are useful for creating cycles, fading transitions, flashing effects, and driving procedural math animations.

<code name="oscillatorExample" default="true">Oscilloscope Waves</code>

::: api oscSine( timer? ) : float - Generates a sine wave oscillation based on a timer (defaults to `time`). :::

::: api oscSquare( timer? ) : float - Generates a square wave oscillation based on a timer (defaults to `time`). :::

::: api oscTriangle( timer? ) : float - Generates a triangle wave oscillation based on a timer (defaults to `time`). :::

::: api oscSawtooth( timer? ) : float - Generates a sawtooth wave oscillation based on a timer (defaults to `time`). :::

```tsl oscillatorExample
import 'scenes/empty';
import { screenUV, color, float, time, smoothstep, min, max, oscSine, oscSquare, oscTriangle, oscSawtooth } from 'three/tsl';

const x = screenUV.x;
const y = screenUV.y;
const speed = time.mul( 0.5 );

// Helper function to draw a continuous wave line in its track
const drawWave = ( waveFunc, offset ) => {

	// Sample the wave at x - dx and x + dx to connect vertical jumps
	const dx = float( 0.0015 );
	const tLeft = x.sub( dx ).mul( 8.0 ).sub( speed );
	const tRight = x.add( dx ).mul( 8.0 ).sub( speed );

	const valLeft = waveFunc( tLeft );
	const valRight = waveFunc( tRight );

	const valMin = min( valLeft, valRight );
	const valMax = max( valLeft, valRight );

	// Scale wave range [0, 1] to track height (0.16) and apply vertical offset
	const targetMin = valMin.mul( 0.16 ).add( offset ).sub( 0.003 );
	const targetMax = valMax.mul( 0.16 ).add( offset ).add( 0.003 );

	// Draw a smooth line between targetMin and targetMax
	const d1 = y.sub( targetMin );
	const d2 = targetMax.sub( y );

	return smoothstep( 0.0, 0.002, d1 ).mul( smoothstep( 0.0, 0.002, d2 ) );

};

// 1. Color-code each wave in its respective vertical track (each 0.25 high)
const color0 = color( 0x00ffcc ).mul( drawWave( oscSine, 0.045 ) ); // Track 0: Sine (bottom)
const color1 = color( 0xffaa00 ).mul( drawWave( oscSquare, 0.295 ) ); // Track 1: Square
const color2 = color( 0xff00bb ).mul( drawWave( oscTriangle, 0.545 ) ); // Track 2: Triangle
const color3 = color( 0x00aaff ).mul( drawWave( oscSawtooth, 0.795 ) ); // Track 3: Sawtooth (top)

// Combine wave colors
const wavesColor = color0.add( color1 ).add( color2 ).add( color3 );

// Dark screen background
const bg = color( 0x050508 );

// Assign oscilloscope to renderPipeline
renderPipeline.outputNode = bg.add( wavesColor );
```
