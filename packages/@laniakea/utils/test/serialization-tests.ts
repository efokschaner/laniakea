import { expect } from 'chai';
import 'mocha';

import {
  measureAndSerialize,
  ReadStream,
  Serializable,
  SerializationStream,
} from '@laniakea/utils';

class Foo implements Serializable {
  public aNumber = 0;
  public anArray = new Uint8Array();

  public serialize(stream: SerializationStream) {
    this.aNumber = stream.serializeUint32(this.aNumber);
    this.anArray = stream.serializeUint8Array(this.anArray);
  }
}

describe('serialization', () => {
  it('reads and writes', () => {
    let foo1 = new Foo();
    foo1.aNumber = 42;
    foo1.anArray = new Uint8Array(84);
    foo1.anArray.fill(168);
    let serialized = measureAndSerialize(foo1);
    let foo2 = new Foo();
    let readStream = new ReadStream(new DataView(serialized));
    foo2.serialize(readStream);
    expect(foo2.aNumber).to.equal(foo1.aNumber);
    expect(foo2.anArray.length).to.equal(foo1.anArray.length);
    expect(foo2.anArray).to.eql(foo1.anArray);
  });
});
