*Inheritance: Loader →*

# AnimationLoader

Class for loading animation clips in the JSON format. The files are internally loaded via [FileLoader](FileLoader.md).

## Code Example

```js
const loader = new THREE.AnimationLoader();
const animations = await loader.loadAsync( 'animations/animation.js' );
```

## Constructor

### new AnimationLoader( manager : LoadingManager )

Constructs a new animation loader.

**manager**

The loading manager.

## Methods

### .load( url : string, onLoad : function, onProgress : onProgressCallback, onError : onErrorCallback )

Starts loading from the given URL and pass the loaded animations as an array holding instances of [AnimationClip](AnimationClip.md) to the `onLoad()` callback.

**url**

The path/URL of the file to be loaded. This can also be a data URI.

**onLoad**

Executed when the loading process has been finished.

**onProgress**

Executed while the loading is in progress.

**onError**

Executed when errors occur.

**Overrides:** [Loader#load](Loader.md#load)

### .parse( json : Object ) : Array.<AnimationClip>

Parses the given JSON object and returns an array of animation clips.

**json**

The serialized animation clips.

**Overrides:** [Loader#parse](Loader.md#parse)

**Returns:** The parsed animation clips.

## Source

[src/loaders/AnimationLoader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/loaders/AnimationLoader.js)
