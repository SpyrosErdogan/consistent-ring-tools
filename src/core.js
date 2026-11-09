const DEFAULT_REPLICAS = 64;

/**
 * FNV-1a 32-bit hash. Chosen because it is tiny, dependency-free, and
 * distributes keys well enough for ring placement. Cryptographic strength is
 * not needed here, and a faster non-cryptographic hash keeps rebalancing cheap.
 *
 * @param {string} key
 * @returns {number} unsigned 32-bit integer
 */
export function fnv1a32(key) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    // Multiply by the FNV prime (16777619) using shifts to stay in 32-bit ints.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A consistent hash ring with virtual nodes.
 *
 * Each physical node is mapped to `replicas` points on a 32-bit ring. A key is
 * placed by hashing it and walking clockwise to the first point at or after the
 * key's hash. Virtual nodes are required for even distribution: with one point
 * per node, a handful of nodes produce wildly uneven load.
 */
export class ConsistentRing {
  /**
   * @param {{ replicas?: number }} [options]
   */
  constructor(options = {}) {
    const replicas = options.replicas === undefined ? DEFAULT_REPLICAS : options.replicas;
    if (!Number.isInteger(replicas) || replicas < 1) {
      throw new RangeError('replicas must be a positive integer');
    }
    this.replicas = replicas;
    /** @type {Array<{ hash: number, node: string }>} */
    this._points = [];
    /** @type {Map<string, number[]>} */
    this._nodeHashes = new Map();
  }

  /**
   * Add a physical node. Adding the same node twice is a no-op so callers can
   * safely replay a membership list.
   *
   * @param {string} node
   */
  addNode(node) {
    if (typeof node !== 'string' || node.length === 0) {
      throw new TypeError('node must be a non-empty string');
    }
    if (this._nodeHashes.has(node)) {
      return;
    }
    const hashes = [];
    for (let i = 0; i < this.replicas; i++) {
      const hash = fnv1a32(`${node}#${i}`);
      hashes.push(hash);
      this._points.push({ hash, node });
    }
    this._nodeHashes.set(node, hashes);
    this._points.sort((a, b) => a.hash - b.hash || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
  }

  /**
   * Remove a physical node and all of its virtual points.
   *
   * @param {string} node
   * @returns {boolean} true if the node was present
   */
  removeNode(node) {
    if (!this._nodeHashes.has(node)) {
      return false;
    }
    this._nodeHashes.delete(node);
    this._points = this._points.filter((p) => p.node !== node);
    return true;
  }

  /**
   * @returns {string[]} nodes in insertion order
   */
  nodes() {
    return Array.from(this._nodeHashes.keys());
  }

  /**
   * Find the node responsible for a key.
   *
   * @param {string} key
   * @returns {string | undefined} undefined when the ring is empty
   */
  getNode(key) {
    if (this._points.length === 0) {
      return undefined;
    }
    const hash = fnv1a32(key);
    // Binary search for the first point with hash >= key hash.
    let lo = 0;
    let hi = this._points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._points[mid].hash < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const idx = lo === this._points.length ? 0 : lo;
    return this._points[idx].node;
  }

  /**
   * Convenience wrapper returning an array of distinct nodes for a key.
   *
   * @param {string} key
   * @param {number} count
   * @returns {string[]}
   */
  getNodes(key, count) {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError('count must be a positive integer');
    }
    const total = this._nodeHashes.size;
    if (total === 0) {
      return [];
    }
    const wanted = Math.min(count, total);
    const start = this.getNode(key);
    const result = [];
    const seen = new Set();
    let idx = this._points.findIndex((p) => p.node === start);
    if (idx === -1) {
      idx = 0;
    }
    // Walk clockwise collecting distinct physical nodes. The loop is bounded by
    // the number of points, so it always terminates even if replicas is large.
    for (let step = 0; step < this._points.length && result.length < wanted; step++) {
      const point = this._points[(idx + step) % this._points.length];
      if (!seen.has(point.node)) {
        seen.add(point.node);
        result.push(point.node);
      }
    }
    return result;
  }
}
