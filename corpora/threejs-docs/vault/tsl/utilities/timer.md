# Timer

Timer nodes allow accessing the elapsed time and the delta time of the current frame in seconds. These nodes are useful for driving procedural animations, physics simulations in compute shaders, and dynamic visual effects.

<code name="timeExample" default="true">Time</code>

::: api time : float - Represents the elapsed time in seconds. :::

::: api deltaTime : float - Represents the delta time in seconds. :::

```tsl timeExample
import 'scenes/shaderball';
import { positionLocal, time, color } from 'three/tsl';

// Continuous pulsing wave driven by elapsed time
const wave = positionLocal.y.mul( 4.0 ).add( time.mul( 2.0 ) ).sin().mul( 0.5 ).add( 0.5 );

// Interpolate colors based on wave intensity
const baseColor = color( 0x050c1a );
const glowColor = color( 0x00f0ff );

model.material.colorNode = wave.mix( baseColor, glowColor );
model.material.roughness = 0.25;
model.material.metalness = 0.75;
```
