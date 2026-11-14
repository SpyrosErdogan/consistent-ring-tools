# consistent-ring-tools

Consistent hashing with virtual nodes for stable key distribution.

```js
import { ConsistentRing } from 'consistent-ring-tools';

const ring = new ConsistentRing({ replicas: 64 });
ring.addNode('cache-a');
ring.addNode('cache-b');
ring.addNode('cache-c');

ring.getNode('user:42');       // => 'cache-b' (stable for this key)
ring.getNodes('user:42', 2);   // => ['cache-b', 'cache-a'] (distinct nodes)
ring.removeNode('cache-b');    // => true
```

The package exports `ConsistentRing` and `fnv1a32`.

## Why this exists

When a key-value store grows or shrinks, a naive `hash(key) % nodeCount` mapping
reshuffles almost every key, which invalidates caches and forces mass data
movement. A consistent hash ring only remaps the keys that belonged to the node
that changed. Virtual nodes (replicas) are the trade-off: they cost memory and
insertion time, but without them a handful of physical nodes produce badly
skewed load. The default is 64 virtual points per node, which is enough for
small clusters without wasting much memory.

## The awkward edge

An empty ring returns `undefined` from `getNode` and `[]` from `getNodes`.
Callers must handle that case before using the result as a key. Adding a node
that is already present is a no-op, so replaying a membership list is safe.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

