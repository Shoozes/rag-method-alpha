# Seamless Integration

- Unified Code
  - Write shader logic directly in JS/TS, eliminating the need to manipulate strings.
  - Use the same TSL syntax across all GPU components:
     - Materials, Post-Processing, Compute (GPGPU), Particles, Lights, etc.
  - Create and manipulate render objects just like any other JavaScript logic inside a TSL function.
  - Advanced events to control a Node before and after the object is rendered.
- JS Ecosystem
  - Use native **import/export**, **NPM**, and integrate **JS/TS** components directly into your shader logic.
- Typing
  - Benefit from better type checking (**TypeScript** and **[@three-types](https://github.com/three-types/three-ts-types)**), increasing code robustness.
