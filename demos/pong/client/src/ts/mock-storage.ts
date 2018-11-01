export class MockStorage implements Storage {
  public store = new Map<string, string>();
  public get length() {
    return this.store.size;
  }
  public key(n: number) {
    let keys = Array.from(this.store.keys());
    if (n >= keys.length) {
      return null;
    }
    return keys[n];
  }
  public getItem(key: string) {
    let result = this.store.get(key);
    if (result === undefined) {
      return null;
    }
    return result;
  }
  public setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  public removeItem(key: string) {
    this.store.delete(key);
  }
  public clear() {
    this.store.clear();
  }
}
