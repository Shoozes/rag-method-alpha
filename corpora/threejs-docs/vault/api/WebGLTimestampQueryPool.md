*Inheritance: TimestampQueryPool →*

# WebGLTimestampQueryPool

Manages a pool of WebGL timestamp queries for performance measurement. Handles creation, execution, and resolution of timer queries using WebGL extensions.

## Constructor

### new WebGLTimestampQueryPool( gl : WebGLRenderingContext | WebGL2RenderingContext, type : string, maxQueries : number )

Creates a new WebGL timestamp query pool.

**gl**

The WebGL context.

**type**

The type identifier for this query pool.

**maxQueries**

Maximum number of queries this pool can hold.

Default is `2048`.

## Methods

### .allocateQueriesForContext( uid : string ) : number

Allocates a pair of queries for a given render context.

**uid**

A unique identifier for the render context.

**Overrides:** [TimestampQueryPool#allocateQueriesForContext](TimestampQueryPool.md#allocateQueriesForContext)

**Returns:** The base offset for the allocated queries, or null if allocation failed.

### .beginQuery( uid : string )

Begins a timestamp query for the specified render context.

**uid**

A unique identifier for the render context.

### .dispose()

Releases all resources held by this query pool. This includes deleting all query objects and clearing internal state.

**Overrides:** [TimestampQueryPool#dispose](TimestampQueryPool.md#dispose)

### .endQuery( uid : string )

Ends the active timestamp query for the specified render context.

**uid**

A unique identifier for the render context.

### .resolveQueriesAsync() : Promise.<number> (async)

Asynchronously resolves all completed queries and returns the total duration.

**Overrides:** [TimestampQueryPool#resolveQueriesAsync](TimestampQueryPool.md#resolveQueriesAsync)

**Returns:** The total duration in milliseconds, or the last valid value if resolution fails.

### .resolveQuery( query : WebGLQuery ) : Promise.<number> (async)

Resolves a single query, checking for completion and disjoint operation.

**query**

The query object to resolve.

**Returns:** The elapsed time in milliseconds.

## Source

[src/renderers/webgl-fallback/utils/WebGLTimestampQueryPool.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/renderers/webgl-fallback/utils/WebGLTimestampQueryPool.js)
