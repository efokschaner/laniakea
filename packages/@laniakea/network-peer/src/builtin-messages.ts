import {
  ClassRegistry,
  Serializable,
  SerializationStream,
  ShortTypeId,
  TypeId,
} from '@laniakea/utils';

export class S2C_BuiltinHandshakeMessage implements Serializable {
  public classRegistryDictionary = new Array<[TypeId, ShortTypeId]>();

  public serialize(stream: SerializationStream): void {
    this.classRegistryDictionary.length = stream.serializeUint16(
      this.classRegistryDictionary.length
    );
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

export function registerBuiltinMessages(
  classRegistry: ClassRegistry<Serializable>
): void {
  const RESERVED_SHORT_ID = 1 as ShortTypeId;
  // Ensure that this message has a guaranteed ID as it is the message that transmits IDs
  let handshakeTypeInfo = classRegistry.registerClass(
    S2C_BuiltinHandshakeMessage,
    '__S2C_BuiltinHandshakeMessage'
  );
  if (handshakeTypeInfo.shortTypeId !== RESERVED_SHORT_ID) {
    // Swap the current occupant with S2C_BuiltinHandshakeMessage
    let currentTypeWithReservedId = classRegistry.getTypeInfoByShortTypeId(
      RESERVED_SHORT_ID
    );
    let currentMappings = classRegistry.getTypeIdToShortTypeIdMapping();
    let newMappings = currentMappings.filter(
      ([, shortTypeId]) =>
        !(
          shortTypeId === RESERVED_SHORT_ID ||
          shortTypeId === handshakeTypeInfo.shortTypeId
        )
    );
    newMappings.push([handshakeTypeInfo.typeId, RESERVED_SHORT_ID]);
    if (currentTypeWithReservedId !== undefined) {
      newMappings.push([
        currentTypeWithReservedId.typeId,
        handshakeTypeInfo.shortTypeId,
      ]);
    }
    classRegistry.setTypeIdToShortTypeIdMapping(newMappings);
  }
}
