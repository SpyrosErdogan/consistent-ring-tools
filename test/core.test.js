import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsistentRing, fnv1a32 } from '../src/index.js';

test('fnv1a32 is deterministic and returns an unsigned 32-bit integer', () => {
  const a = fnv1a32('hello');
  const b = fnv1a32('hello');
  assert.equal(a, b);
  assert.ok(Number.isInteger(a));
  assert.ok(a >= 0 && a <= 0xffffffff);
});

test('fnv1a32 differs for different inputs', () => {
  assert.notEqual(fnv1a32('alpha'), fnv1a32('beta'));
});

test('constructor rejects invalid replica counts', () => {
  assert.throws(() => new ConsistentRing({ replicas: 0 }), RangeError);
  assert.throws(() => new ConsistentRing({ replicas: -1 }), RangeError);
  assert.throws(() => new ConsistentRing({ replicas: 1.5 }), RangeError);
});

test('empty ring returns undefined', () => {
  const ring = new ConsistentRing();
  assert.equal(ring.getNode('anything'), undefined);
  assert.deepEqual(ring.nodes(), []);
  assert.deepEqual(ring.getNodes('anything', 3), []);
});

test('addNode rejects invalid names and is idempotent', () => {
  const ring = new ConsistentRing();
  assert.throws(() => ring.addNode(''), TypeError);
  assert.throws(() => ring.addNode(42), TypeError);
  ring.addNode('node-a');
  ring.addNode('node-a');
  assert.deepEqual(ring.nodes(), ['node-a']);
  assert.equal(ring.getNode('key'), 'node-a');
});

test('removeNode reports whether the node existed', () => {
  const ring = new ConsistentRing();
  ring.addNode('node-a');
  assert.equal(ring.removeNode('node-a'), true);
  assert.equal(ring.removeNode('node-a'), false);
  assert.deepEqual(ring.nodes(), []);
});

test('single node owns every key', () => {
  const ring = new ConsistentRing({ replicas: 4 });
  ring.addNode('only');
  for (const key of ['a', 'b', 'c', 'd', 'e']) {
    assert.equal(ring.getNode(key), 'only');
  }
});

test('keys map deterministically to nodes', () => {
  const ring = new ConsistentRing({ replicas: 16 });
  ring.addNode('node-a');
  ring.addNode('node-b');
  ring.addNode('node-c');
  const first = ring.getNode('stable-key');
  const second = ring.getNode('stable-key');
  assert.equal(first, second);
  assert.ok(['node-a', 'node-b', 'node-c'].includes(first));
});

test('getNodes returns distinct nodes and respects count', () => {
  const ring = new ConsistentRing({ replicas: 8 });
  ring.addNode('node-a');
  ring.addNode('node-b');
  ring.addNode('node-c');
  const nodes = ring.getNodes('some-key', 2);
  assert.equal(nodes.length, 2);
  assert.equal(new Set(nodes).size, 2);
  assert.ok(nodes.every((n) => ['node-a', 'node-b', 'node-c'].includes(n)));
});

test('getNodes clamps to the number of physical nodes', () => {
  const ring = new ConsistentRing({ replicas: 4 });
  ring.addNode('node-a');
  ring.addNode('node-b');
  const nodes = ring.getNodes('key', 10);
  assert.equal(nodes.length, 2);
  assert.equal(new Set(nodes).size, 2);
});

test('getNodes rejects invalid counts', () => {
  const ring = new ConsistentRing();
  ring.addNode('node-a');
  assert.throws(() => ring.getNodes('key', 0), RangeError);
  assert.throws(() => ring.getNodes('key', -1), RangeError);
  assert.throws(() => ring.getNodes('key', 1.5), RangeError);
});

test('distribution is roughly even with many virtual nodes', () => {
  const ring = new ConsistentRing({ replicas: 128 });
  const nodes = ['a', 'b', 'c', 'd'];
  for (const n of nodes) {
    ring.addNode(n);
  }
  const counts = new Map(nodes.map((n) => [n, 0]));
  const total = 4000;
  for (let i = 0; i < total; i++) {
    const owner = ring.getNode(`key-${i}`);
    counts.set(owner, counts.get(owner) + 1);
  }
  // With 128 replicas the load should be within a generous band of the mean.
  const mean = total / nodes.length;
  for (const n of nodes) {
    const c = counts.get(n);
    assert.ok(c > mean * 0.5, `${n} owns only ${c}`);
    assert.ok(c < mean * 1.5, `${n} owns ${c}`);
  }
});

test('removing a node only reassigns its keys', () => {
  const ring = new ConsistentRing({ replicas: 32 });
  ring.addNode('node-a');
  ring.addNode('node-b');
  ring.addNode('node-c');
  const keys = [];
  for (let i = 0; i < 200; i++) {
    keys.push(`key-${i}`);
  }
  const before = keys.map((k) => ring.getNode(k));
  ring.removeNode('node-b');
  const after = keys.map((k) => ring.getNode(k));
  for (let i = 0; i < keys.length; i++) {
    if (before[i] !== 'node-b') {
      assert.equal(after[i], before[i], `key ${keys[i]} moved unexpectedly`);
    } else {
      assert.ok(after[i] === 'node-a' || after[i] === 'node-c');
    }
  }
});
