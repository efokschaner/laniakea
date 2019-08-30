import { SyncEvent } from 'ts-events';

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

/**
 * Generic, Observable, and Persisted setting
 */
export class ClientSetting<T> extends SyncEvent<T> {
  constructor(private _storage: Storage, private _name: string, defaultValue: T) {
    super();
    this._value = readValueFromStorage(this._storage, this._name, defaultValue);
  }
  public get(): T {
    return this._value;
  }
  public set(value: T): void {
    this._value = value;
    writeValueToStorage(this._storage, this._name, value);
    this.post(this._value);
  }
  public get value(): T {
    return this._value;
  }
  public set value(value: T) {
    this.set(value);
  }
  private _value: T;
}

export class ClientSettings {
  constructor(private _storage: Storage) {
  }

  public readonly clientIsBot = new ClientSetting<boolean>(this._storage, 'clientIsBot', false);
  public readonly clientSimulationEnabled = new ClientSetting<boolean>(this._storage, 'clientSimulationEnabled', true);
  public readonly subFrameInterpolationEnabled = new ClientSetting<boolean>(this._storage, 'subFrameInterpolationEnabled', true);

}
