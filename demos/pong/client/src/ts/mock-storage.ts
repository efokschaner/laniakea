export class MockStorage implements Storage {
  public store = new Map<string, string>();
  public get length(): number {
    return this.store.size;
  }
  public key(n: number): string | null {
    let keys = Array.from(this.store.keys());
    if (n >= keys.length) {
      return null;
    }
    return keys[n];
  }
  public getItem(key: string): string | null {
    let result = this.store.get(key);
    if (result === undefined) {
      return null;
    }
    return result;
  }
  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  public removeItem(key: string): void {
    this.store.delete(key);
  }
  public clear(): void {
    this.store.clear();
  }
}
