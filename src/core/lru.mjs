// A small LRU cache for tool results. Tools are pure over the loaded data,
// so a result keyed by (data version, tool, arguments) is safe to reuse
// until the data changes.

export class Lru {
  constructor(max = 200) {
    this.max = max;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }
  get(key) {
    if (!this.map.has(key)) {
      this.misses++;
      return undefined;
    }
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    this.hits++;
    return value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return value;
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
}
