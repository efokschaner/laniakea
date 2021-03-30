import { expect } from 'chai';
import 'mocha';

import {
  ClassRegistry,
  Serializable,
  SerializationStream,
} from '@laniakea/utils';

describe('ClassRegistry', () => {
  it('works with Serializable', () => {
    class Foo implements Serializable {
      public serialize(_stream: SerializationStream): void {
        throw new Error('Method not implemented.');
      }
    }
    let cr = new ClassRegistry<Serializable>();
    cr.registerClass(Foo, 'Foo');
    expect(cr.getTypeInfoByConstructor(Foo)!.typeName).to.equal('Foo');
  });

  it('works with object', () => {
    class Foo {}
    // eslint-disable-next-line @typescript-eslint/ban-types
    let cr = new ClassRegistry<object>();
    cr.registerClass(Foo, 'Foo');
    expect(cr.getTypeInfoByConstructor(Foo)!.typeName).to.equal('Foo');
  });

  it('works with Object', () => {
    class Foo {
      public bar = 42;
    }
    // eslint-disable-next-line @typescript-eslint/ban-types
    let cr = new ClassRegistry<Object>();
    cr.registerClass(Foo, 'Foo');
    expect(cr.getTypeInfoByConstructor(Foo)!.typeName).to.equal('Foo');
  });
});
