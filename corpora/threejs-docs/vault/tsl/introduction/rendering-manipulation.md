# Rendering Manipulation

Control rendering steps and create new render-passes per individual TSL functions.

- Implementing complex effects is easy with nodes using a single function call, either in post-processing or in materials, allowing the node itself to manage the rendering process.
  - `gaussianBlur()`: A two-pass Gaussian blur node usable directly in materials or post-processing passes.
- Easy access to renderer buffers using TSL functions like:
  - `viewportSharedTexture()`: Accesses what has already been rendered (beauty pass), preserving render order.
  - `viewportLinearDepth()`: Accesses the depth buffer that has already been rendered, preserving render order.
 - Integrated Compute Shaders
   - Perform calculations on buffers using compute stage directly during an object's rendering.
 - TSL allows dynamic manipulation of renderer functions, which makes it more customizable than intermediate languages that would have to use flags in fixed pipelines for this.
 - You just need to use the events of a Node for the renderer manipulations, without needing to modify the core.
