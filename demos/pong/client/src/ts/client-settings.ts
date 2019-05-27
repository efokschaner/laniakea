let storagePrefix = 'pong-demo-client-settings:';

function readValueFromStorage<T>(storage: Storage, key: string, defaultVal: T): T {
  let maybeItem = storage.getItem(storagePrefix + key);
  if (maybeItem == null) {
    return defaultVal;
  }
  return JSON.parse(maybeItem);
}

function writeValueToStorage(storage: Storage, key: string, item: any) {
  storage.setItem(storagePrefix + key, JSON.stringify(item));
}

export class ClientSettings {
  constructor(private storage: Storage) {
    this._clientIsBot = readValueFromStorage(this.storage, 'clientIsBot', false);
  }

  private _clientIsBot: boolean;
  public get clientIsBot(): boolean {
    return this._clientIsBot!;
  }
  public set clientIsBot(value: boolean) {
    this._clientIsBot = value;
    writeValueToStorage(this.storage, 'clientIsBot', value);
  }
}
