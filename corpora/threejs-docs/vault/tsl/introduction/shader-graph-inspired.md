# Shader-Graph Inspired

- Focus on Intent
  - Build materials by connecting nodes through: [position](#position), [normal](#normal), [screen](#screen), [attribute](#attributes), etc.
  - More **declarative** ('what') rather than **imperative** ('how').
- Composition & High-Level Concepts
  - Work with high-level concepts for Node Material like [colorNode](#node-material), [roughnessNode](#node-material), [metalnessNode](#node-material), [positionNode](#node-material), etc. This preserves the integrity of the lighting model while allowing customizations, helping to avoid mistakes from incorrect setups.
- Keeping an eye on software exchange
  - Modern 3D authoring software uses Shader-Graph based material composition to exchange between other software. TSL already has its own MaterialX integration.
- Easier Migration
  - Many functions are directly inspired by GLSL to smooth the learning curve for those with prior experience.
