# Noise

MaterialX procedural noise nodes provide GPU-native, resolution-independent texture and value generators based on the open standards developed by Industrial Light & Magic (ILM) and the Academy Software Foundation (ASWF).

In TSL, these noise nodes run directly on the GPU across both WebGPU and WebGL backends, enabling organic surfaces, dynamic terrain displacement, fluid visual effects, and animated patterns without needing any external texture image assets.

### Perlin Noise

<code name="perlinNoiseFloat" default="true">Perlin (Float)</code> <code name="perlinNoiseVec3">Perlin (vec3)</code>

::: api mx_noise_float( texcoord?, amplitude?, pivot? ) : float - Computes 2D/3D Perlin value noise returning a scalar float.
- **texcoord**: `vec2 | vec3` - Evaluation coordinate node. Defaults to `uv()`.
- **amplitude**: `float | number` - Amplitude scaling multiplier. Defaults to `1`.
- **pivot**: `float | number` - Value offset added to the result. Defaults to `0`.
:::

::: api mx_noise_vec3( texcoord?, amplitude?, pivot? ) : vec3 - Computes 2D/3D Perlin vector noise returning a 3D vector.
- **texcoord**: `vec2 | vec3` - Evaluation coordinate node. Defaults to `uv()`.
- **amplitude**: `float | number` - Amplitude scaling multiplier. Defaults to `1`.
- **pivot**: `float | number` - Value offset added to the result. Defaults to `0`.
:::

### Cell Noise

<code name="cellNoiseFloat">Cell (Float)</code> <code name="cellNoiseVec3">Cell (Color)</code>

::: api mx_cell_noise_float( texcoord? ) : float - Generates 2D/3D Voronoi cellular noise returning a scalar float per cell.
- **texcoord**: `vec2 | vec3` - Coordinate node. Defaults to `uv()`.
:::

::: api mx_cell_noise_vec3( texcoord? ) : vec3 - Generates 2D/3D Voronoi cellular noise returning random RGB color per cell.
- **texcoord**: `vec2 | vec3` - Coordinate node. Defaults to `uv()`.
:::

### Worley Noise

<code name="worleyNoiseF1">Worley (F1)</code> <code name="worleyNoiseBorders">Worley (Borders)</code> <code name="worleyNoiseVec2">Worley (vec2)</code> <code name="worleyNoiseVec3">Worley (vec3)</code>

::: api mx_worley_noise_float( texcoord?, jitter?, style? ) : float - Generates 3D Worley distance noise. `style = 0` calculates F1 distance, `style = 1` calculates F2 - F1 boundary distance.
- **texcoord**: `vec2 | vec3` - Coordinate node. Defaults to `uv()`.
- **jitter**: `float | number` - Feature jitter randomness factor. Defaults to `1`.
- **style**: `int | number` - Distance style formula (`0` for F1, `1` for F2 - F1). Defaults to `0`.
:::

::: api mx_worley_noise_vec2( texcoord?, jitter? ) : vec2 - Computes Worley closest feature distances `vec2(F1, F2)`.
- **texcoord**: `vec2 | vec3` - Coordinate node. Defaults to `uv()`.
- **jitter**: `float | number` - Jitter factor. Defaults to `1`.
:::

::: api mx_worley_noise_vec3( texcoord?, jitter?, metric? ) : vec3 - Computes Worley feature distances `vec3(F1, F2, F3)`.
- **texcoord**: `vec2 | vec3` - Coordinate node. Defaults to `uv()`.
- **jitter**: `float | number` - Jitter factor. Defaults to `1`.
- **metric**: `int | number` - Distance metric mode (`0` Euclidean, `1` Manhattan, `2` Chebyshev). Defaults to `1`.
:::

### Fractal Noise (FBM)

<code name="fractalNoiseFloat">Fractal (Float)</code> <code name="fractalNoiseVec3">Fractal (vec3)</code>

::: api mx_fractal_noise_float( position?, octaves?, lacunarity?, diminish?, amplitude? ) : float - Computes scalar multi-octave Fractal Brownian Motion (FBM) noise.
- **position**: `vec2 | vec3` - Coordinate node. Defaults to `uv()`.
- **octaves**: `int | number` - Number of octave layers. Defaults to `3`.
- **lacunarity**: `float | number` - Frequency multiplier between octaves. Defaults to `2`.
- **diminish**: `float | number` - Amplitude decay factor per octave. Defaults to `0.5`.
- **amplitude**: `float | number` - Output amplitude multiplier. Defaults to `1`.
:::

::: api mx_fractal_noise_vec3( position?, octaves?, lacunarity?, diminish?, amplitude? ) : vec3 - Computes 3D vector multi-octave Fractal noise.
- **position**: `vec2 | vec3` - Coordinate node. Defaults to `uv()`.
- **octaves**: `int | number` - Number of octave layers. Defaults to `3`.
- **lacunarity**: `float | number` - Frequency multiplier per octave. Defaults to `2`.
- **diminish**: `float | number` - Amplitude decay factor per octave. Defaults to `0.5`.
- **amplitude**: `float | number` - Output amplitude multiplier. Defaults to `1`.
:::

### Unified Noise

<code name="unifiedNoise3D">Unified (3D)</code>

::: api mx_unifiednoise3d( noiseType, texcoord?, freq?, offset?, jitter?, outmin?, outmax?, clampoutput?, octaves?, lacunarity?, diminish?, style? ) : Node - Unified 3D noise interface supporting `0: Perlin`, `1: Cell`, `2: Worley`, `3: Fractal`.
- **noiseType**: `int | number` - Noise algorithm (`0` to `3`).
- **texcoord**: `vec3` - Coordinate vector node. Defaults to `uv()`.
- **freq**: `vec3` - Spatial frequency vector. Defaults to `vec3(1, 1, 1)`.
- **offset**: `vec3` - Spatial animation offset. Defaults to `vec3(0, 0, 0)`.
- **jitter**: `float` - Worley jitter factor. Defaults to `1`.
- **outmin**: `float` - Minimum mapped output. Defaults to `0`.
- **outmax**: `float` - Maximum mapped output. Defaults to `1`.
- **clampoutput**: `bool` - Clamp output between `outmin` and `outmax`. Defaults to `false`.
- **octaves**: `int` - Octaves for fractal mode. Defaults to `1`.
- **lacunarity**: `float` - Lacunarity factor. Defaults to `2`.
- **diminish**: `float` - Diminish factor. Defaults to `0.5`.
- **style**: `int` - Worley noise style. Defaults to `0`.
:::

```tsl perlinNoiseFloat
import 'scenes/shaderball';
import { uv, mx_noise_float } from 'three/tsl';

model.material.colorNode = mx_noise_float( uv().mul( 100.0 ) );
```

```tsl perlinNoiseVec3
import 'scenes/shaderball';
import { uv, mx_noise_vec3 } from 'three/tsl';

model.material.colorNode = mx_noise_vec3( uv().mul( 100.0 ) );
```

```tsl cellNoiseFloat
import 'scenes/shaderball';
import { uv, mx_cell_noise_float } from 'three/tsl';

model.material.colorNode = mx_cell_noise_float( uv().mul( 100.0 ) );
```

```tsl cellNoiseVec3
import 'scenes/shaderball';
import { uv, mx_cell_noise_vec3 } from 'three/tsl';

model.material.colorNode = mx_cell_noise_vec3( uv().mul( 100.0 ) );
```

```tsl worleyNoiseF1
import 'scenes/shaderball';
import { uv, mx_worley_noise_float } from 'three/tsl';

model.material.colorNode = mx_worley_noise_float( uv().mul( 100.0 ), 1.0, 0 );
```

```tsl worleyNoiseBorders
import 'scenes/shaderball';
import { uv, mx_worley_noise_float } from 'three/tsl';

model.material.colorNode = mx_worley_noise_float( uv().mul( 100.0 ), 1.0, 1 );
```

```tsl worleyNoiseVec2
import 'scenes/shaderball';
import { uv, mx_worley_noise_vec2 } from 'three/tsl';

model.material.colorNode = mx_worley_noise_vec2( uv().mul( 100.0 ) );
```

```tsl worleyNoiseVec3
import 'scenes/shaderball';
import { uv, mx_worley_noise_vec3 } from 'three/tsl';

model.material.colorNode = mx_worley_noise_vec3( uv().mul( 100.0 ) );
```

```tsl fractalNoiseFloat
import 'scenes/shaderball';
import { uv, mx_fractal_noise_float } from 'three/tsl';

model.material.colorNode = mx_fractal_noise_float( uv().mul( 100.0 ), 4 );
```

```tsl fractalNoiseVec3
import 'scenes/shaderball';
import { uv, mx_fractal_noise_vec3 } from 'three/tsl';

model.material.colorNode = mx_fractal_noise_vec3( uv().mul( 100.0 ), 4 );
```

```tsl unifiedNoise3D
import 'scenes/shaderball';
import { positionLocal, int, vec3, mx_unifiednoise3d } from 'three/tsl';

model.material.colorNode = mx_unifiednoise3d( int( 0 ), positionLocal.mul( 20.0 ), vec3( 1, 1, 1 ) );
```
