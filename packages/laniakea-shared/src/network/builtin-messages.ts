import { ShortTypeId, TypeId } from '../class-registry';
import { Serializable, SerializationStream } from '../serialization';

// Allow our message name format
// tslint:disable:class-name

export class S2C_BuiltinHandshakeMessage implements Serializable {
  public classRegistryDictionary = new Array<[TypeId, ShortTypeId]>();

  public serialize(stream: SerializationStream): void {
    stream.serializeUint16(this.classRegistryDictionary, 'length');
    for (let i = 0; i < this.classRegistryDictionary.length; ++i) {
      if (stream.isWriting) {
        let [id, shortId] = this.classRegistryDictionary[i];
        stream.writeUint32(id);
        stream.writeUint16(shortId);
      } else {
        let id = stream.readUint32() as TypeId;
        let shortId = stream.readUint16() as ShortTypeId;
        this.classRegistryDictionary[i] = [id, shortId];
      }
    }
  }
}
