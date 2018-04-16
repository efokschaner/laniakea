// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

export class CyclicBuffer<T> {
  public entries: Array<{index?: number, data?: T}>;
  constructor(bufferSize: number) {
    this.entries = new Array(bufferSize);
    for (let i = 0; i < this.entries.length; ++i) {
      this.entries[i] = {index: undefined, data: undefined};
    }
  }
  public getElement(index: number) {
    let entryIndex = mod(index, this.entries.length);
    let entry = this.entries[entryIndex];
    if (entry.index === index) {
      return entry.data;
    }
    return undefined;
  }
  public setElement(index: number, data: T) {
    let entryIndex = mod(index, this.entries.length);
    let entry = this.entries[entryIndex];
    entry.index = index;
    entry.data = data;
  }
  public clearElement(index: number) {
    let entryIndex = mod(index, this.entries.length);
    let entry = this.entries[entryIndex];
    entry.index = undefined;
    entry.data = undefined;
  }
}
