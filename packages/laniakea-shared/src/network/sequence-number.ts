import { Serializable, SerializationStream } from '../serialization';

// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function sequenceNumberIsGreaterThan(lhs: number, rhs: number) {
  let halfRange = SequenceNumber.MAX_SEQUENCE_NUMBER_EXCLUSIVE / 2;
  let diff = lhs - rhs;
  return ((diff > 0) && (diff <= halfRange)) || diff < -halfRange;
}

export class SequenceNumber implements Serializable {
  public static NUM_BYTES = 2;
  public static MAX_SEQUENCE_NUMBER_EXCLUSIVE = (2 ** 8) ** SequenceNumber.NUM_BYTES;
  constructor(public readonly value: number = 0) {
    this.value = mod(this.value, SequenceNumber.MAX_SEQUENCE_NUMBER_EXCLUSIVE);
  }
  public serialize(stream: SerializationStream): void {
    stream.serializeUint16(this, 'value');
  }
  public add(num: number) {
    return new SequenceNumber(this.value + num);
  }
  public isGreaterThan(rhs: SequenceNumber) {
    return sequenceNumberIsGreaterThan(this.value, rhs.value);
  }
}

/**
 * Translates a rolling sequence number in to an absolute sequence number
 * based on the assumption that we will never jump more than
 * half the range of the rolling sequence number.
 */
export class AbsoluteSequenceNumberTranslator {
  public static halfwayPoint = SequenceNumber.MAX_SEQUENCE_NUMBER_EXCLUSIVE / 2;
  private epochCounter = 0; // counts the number of times the sequence number has rolled over
  private highestSequenceNumberSeen = new SequenceNumber(0);
  private nearEpoch = true;

  public getAbsoluteSequenceNumber(num: SequenceNumber): number {
    // Wrapping is detected when the new sequence number is greater than the last in wrapping terms, but smaller than the last in absolute terms.
    let numIsGreaterThanHighestSeen = num.isGreaterThan(this.highestSequenceNumberSeen);
    let didWrap = numIsGreaterThanHighestSeen && num.value < this.highestSequenceNumberSeen.value;
    if (didWrap) {
      this.epochCounter += 1;
      this.nearEpoch = true;
    }
    // We are clear of the wrapping region we transition from the first half of the sequence range to the second half
    let clearOfEpoch = (num.value >= AbsoluteSequenceNumberTranslator.halfwayPoint &&
      this.highestSequenceNumberSeen.value < AbsoluteSequenceNumberTranslator.halfwayPoint);
    if (clearOfEpoch) {
      this.nearEpoch = false;
    }
    if (numIsGreaterThanHighestSeen) {
      this.highestSequenceNumberSeen = new SequenceNumber(num.value);
    }
    // If we're near the epoch, the top half of sequnce numbers are treated as negative
    let adjustedValue = num.value;
    if (this.nearEpoch && num.value >= AbsoluteSequenceNumberTranslator.halfwayPoint) {
      adjustedValue = adjustedValue - SequenceNumber.MAX_SEQUENCE_NUMBER_EXCLUSIVE;
    }
    let result = adjustedValue + (this.epochCounter * SequenceNumber.MAX_SEQUENCE_NUMBER_EXCLUSIVE);
    return result;
  }
}
