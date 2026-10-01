# Architecture

All TSL components extend from the `Node` class. A `Node` can communicate with other nodes, value conversions can be automatic or manual, and a `Node` can receive the output value expected by the parent `Node` and modify its own output snippet. It's possible to modularize them using tree shaking in the shader construction process. The `Node` has access to contextual information such as geometry, material, renderer, and graphics backend, which can influence the type and value of its output.

The main class responsible for creating the code and pipeline configuration is `NodeBuilder`. This class can be extended to any output programming language, so you can use TSL for a third language if you wish. Currently, `NodeBuilder` has two concrete implementations: `WGSLNodeBuilder` for WebGPU and `GLSLNodeBuilder` for WebGL2.

Beyond generating shader source code, `NodeBuilder` orchestrates GPU memory allocation and pipeline layouts: GPU buffers (uniform buffers, storage buffers, and attributes) can be dedicated per-object or shared across multiple materials and passes, avoiding redundant GPU memory allocations and state transitions.

### Compilation Process

The build process is based on three pillars: setup, analyze and generate.

```mermaid
flowchart TD
    subgraph TSL["TSL"]
        Graph["<b>Node Graph (AST)</b><br/><small>JavaScript Objects</small>"]
    end

    subgraph Material["Node Material"]
        Inputs["<b>Material Inputs</b><br/><small><code>colorNode, opacityNode, ...</code></small>"]
    end

    subgraph Phases["Node Builder (Target Backend)"]
        Setup["<b>Setup</b><br/><small><code>node.setup( builder )</code></small>"]
        Analyze["<b>Analyze</b><br/><small><code>node.analyze( builder )</code></small>"]
        Generate["<b>Generate</b><br/><small><code>node.generate( builder, output )</code></small>"]
        Setup --> Analyze --> Generate
    end

    subgraph Buffers["GPU Buffers"]
        BufferItems["<b>Uniforms & Storage Buffers</b><br/><small>Dedicated or Shared Buffers</small>"]
    end

    subgraph Bindings["GPU Bindings"]
        direction TB
        Attributes["<b>Attributes</b><br/><small><code>@location(0), @location(1)...</code></small>"]
        BindGroups["<b>Bind Groups</b><br/><small><code>@group(0), @group(1)...</code></small>"]
        Attributes --> BindGroups
    end

    subgraph Shaders["GPU Shaders"]
        direction TB
        ShaderItems["<b>WGSL / GLSL</b><br/><small>Vertex, Fragment, Compute</small>"]
    end

    subgraph Events["CPU Lifecycle"]
        direction TB
        LifeItems["<b>Execution Hooks</b><br/><small><code>updateBefore</code> &rarr; <code>update</code> &rarr; <code>updateAfter</code></small>"]
    end

    subgraph Operations["Runtime Operations"]
        direction TB
        Ops1["<b>Compute & Draw Calls</b><br/><small>Pre-passes, shadow maps, compute dispatches</small>"]
        Ops2["<b>Viewport Texture Sampling</b><br/><small>Capture viewport color / depth textures</small>"]
        Ops3["<b>Uniform & Buffer Updates</b><br/><small>Dynamic matrices, uniforms, buffer swaps</small>"]
        Ops4["<b>Custom Logic & Passes</b><br/><small>User callbacks, custom pipelines & readbacks</small>"]
        Ops1 --> Ops2 --> Ops3 --> Ops4
    end

    TSL --> Material
    Material --> Phases
    Phases --> Shaders
    Phases --> Buffers
    Buffers --> Bindings
    Phases --> Events
    Events --> Operations
```

### Node

The `Node` class is the fundamental abstraction representing every operation, value, texture sample, uniform, and expression within the TSL shading graph. Each node defines its own sub-graph, manages how it is compiled into backend shader code, and interfaces with the compilation pipeline through three primary stages:

::: api .setup( builder ) : Node - Use TSL to create customized logic for the node output, transforming expressions into child node connections. :::

::: api .analyze( builder, output ) : void - Analyzes the node graph to determine reference counts and assign cached variables for optimization. :::

::: api .generate( builder, output ) : string - Emits and returns the concrete shader code string snippet for the active graphics backend. :::

### Update Events & Lifecycle

Nodes can manage CPU-side operations and synchronize data with the GPU during the rendering loop through lifecycle hooks and execution frequency properties:

::: api .updateBeforeType : NodeUpdateType - The update frequency for `.updateBefore()`, executed before rendering begins. :::

::: api .updateType : NodeUpdateType - The update frequency ('frame', 'render', 'object') for `.update()`. :::

::: api .updateAfterType : NodeUpdateType - The update frequency for `.updateAfter()`, executed after rendering completes. :::

::: api .updateBefore( frame ) : void - Executed before rendering operations begin. Ideal for pre-pass setup, allocating dynamic storage buffers and render targets, or evaluating simulation states. :::

::: api .update( frame ) : void - Executed during object preparation right before drawing. Used to update node uniforms, animation matrices, or dynamic parameters. :::

::: api .updateAfter( frame ) : void - Executed after rendering operations have completed. Used for post-render cleanup, ping-pong buffer swaps, or GPU readbacks. :::

#### Update Frequencies

Constants defined in `NodeUpdateType` controlling the execution frequency of update properties:

::: api NodeUpdateType.NONE : string - The update method is disabled and will not be executed ('none'). :::

::: api NodeUpdateType.FRAME : string - Executed once per animation frame (per requestAnimationFrame tick) ('frame'). :::

::: api NodeUpdateType.RENDER : string - Executed once per renderer.render() call (useful for multi-pass rendering, shadow maps, and cubemaps) ('render'). :::

::: api NodeUpdateType.OBJECT : string - Executed once per individual Object3D drawn with the material or node ('object'). :::

### Serialization

Nodes support JSON-based serialization and deserialization, allowing entire node graphs, materials, and custom shader configurations to be saved to disk, shared across projects, or integrated with visual node editors:

::: api .serialize( json ) : object - Serializes the node structure and connections into a JSON object for storage, material exchange, or visual node editors. :::

::: api .deserialize( json ) : void - Restores the node state and connections from a serialized JSON representation. :::
