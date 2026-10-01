# LoaderUtils

A class with loader utility functions.

## Constructor

### new LoaderUtils()

## Static Methods

### .extractUrlBase( url : string ) : string

Extracts the base URL from the given URL.

**url**

The URL to extract the base URL from.

**Returns:** The extracted base URL.

### .resolveURL( url : string, path : string ) : string

Resolves relative URLs against the given path. Absolute paths, data urls, and blob URLs will be returned as is. Invalid URLs will return an empty string.

**url**

The URL to resolve.

**path**

The base path for relative URLs to be resolved against.

**Returns:** The resolved URL.

## Source

[src/loaders/LoaderUtils.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/loaders/LoaderUtils.js)
