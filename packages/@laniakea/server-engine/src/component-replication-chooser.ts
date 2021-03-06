import {
  ComponentAndSerializedData,
  ComponentId,
  NumericComponentId,
} from '@laniakea/base-engine';

enum AckState {
  UNSENT,
  SENT,
  ACKED,
}

const PRIORITY_GROWTH_FACTOR = {
  [AckState.UNSENT]: 100,
  [AckState.SENT]: 10,
  [AckState.ACKED]: 1,
};

const MINUMUM_SEND_PRIORITY = PRIORITY_GROWTH_FACTOR[AckState.UNSENT] / 2;

/**
 * These are an arbitrarily named pair of markers that allow us
 * to detect dead components.
 */
enum AliveMarker {
  FOO,
  BAR,
}

function otherAliveMarker(marker: AliveMarker) {
  return marker === AliveMarker.FOO ? AliveMarker.BAR : AliveMarker.FOO;
}

function byteArraysAreEqual(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

class ComponentReplicationState {
  public constructor(
    public componentId: ComponentId,
    /**
     * A marker that allows us to purge components that were not in the latest frame
     */
    public aliveMarker: AliveMarker,
    public latestState: ComponentAndSerializedData
  ) {}
  public ackState = AckState.UNSENT;
  public currentPriority = PRIORITY_GROWTH_FACTOR[AckState.UNSENT];
}

export class ComponentReplicationChooser {
  private currentFrameMarker = AliveMarker.FOO;
  private componentReplicationStates = new Map<
    NumericComponentId,
    ComponentReplicationState
  >();

  private upsertComponentReplicationState(
    componentId: ComponentId,
    latestState: ComponentAndSerializedData
  ): ComponentReplicationState {
    let componentIdKey = componentId.asNumericId();
    let componentReplicationState = this.componentReplicationStates.get(
      componentIdKey
    );
    if (componentReplicationState === undefined) {
      componentReplicationState = new ComponentReplicationState(
        componentId,
        this.currentFrameMarker,
        latestState
      );
      this.componentReplicationStates.set(
        componentIdKey,
        componentReplicationState
      );
    } else {
      // Set the alive marker as we accessed the component this frame.
      componentReplicationState.aliveMarker = this.currentFrameMarker;
      // If the latest data is different it is considered an unsent state
      if (
        !byteArraysAreEqual(
          componentReplicationState.latestState.serializedData,
          latestState.serializedData
        )
      ) {
        componentReplicationState.ackState = AckState.UNSENT;
      }
      componentReplicationState.latestState = latestState;
      componentReplicationState.currentPriority +=
        PRIORITY_GROWTH_FACTOR[componentReplicationState.ackState];
    }
    return componentReplicationState;
  }

  private updateFromCurrentState(currentState: ComponentAndSerializedData[]) {
    this.currentFrameMarker = otherAliveMarker(this.currentFrameMarker);
    for (let c of currentState) {
      this.upsertComponentReplicationState(c.component.id, c);
    }
    let deadComponents = new Array<ComponentId>();
    for (let componentReplicationState of this.componentReplicationStates.values()) {
      if (componentReplicationState.aliveMarker !== this.currentFrameMarker) {
        deadComponents.push(componentReplicationState.componentId);
      }
    }
    for (let deadComponent of deadComponents) {
      this.componentReplicationStates.delete(deadComponent.asNumericId());
    }
  }

  private getComponentsSortedByPriority(): ComponentReplicationState[] {
    return Array.from(this.componentReplicationStates.values())
      .filter(
        // Filter lower priority items to reduce the amount of sorting work
        (x) => x.currentPriority >= MINUMUM_SEND_PRIORITY
      )
      .sort((a, b) => b.currentPriority - a.currentPriority);
  }

  public getComponentsToSend(
    currentState: ComponentAndSerializedData[],
    maxBytesOfComponentData: number
  ): ComponentAndSerializedData[] {
    this.updateFromCurrentState(currentState);
    let highestPriorityComponents = this.getComponentsSortedByPriority();
    // Get as many messages as we can fit in to maxBytesOfComponentData
    let componentsThatFit = new Array<ComponentAndSerializedData>();
    let combinedLengthOfComponentsThatFit = 0;
    for (let component of highestPriorityComponents) {
      let lengthIncludingNextComponent =
        combinedLengthOfComponentsThatFit +
        component.latestState.serializedData.byteLength;
      // Don't test length on the first component
      // If the first sendable component is too large, accept it and let webrtc deal with fragmentation
      if (
        componentsThatFit.length !== 0 &&
        lengthIncludingNextComponent > maxBytesOfComponentData
      ) {
        // Skip this component as it would take us over the size limit
        continue;
      }
      componentsThatFit.push(component.latestState);
      combinedLengthOfComponentsThatFit = lengthIncludingNextComponent;
      // Only if component is unsent do we mark it as sent. Acked components can get sent but should not raise their AckState to sent.
      if (component.ackState === AckState.UNSENT) {
        component.ackState = AckState.SENT;
      }
      component.currentPriority = 0;
      // If we're less than 8 bytes from the maxLength, it's good enough
      // We're probably not going to find a small enough message to squeeze in, so break out
      if (combinedLengthOfComponentsThatFit > maxBytesOfComponentData - 8) {
        break;
      }
    }
    return componentsThatFit;
  }

  public onComponentsAcked(components: ComponentAndSerializedData[]): void {
    for (let c of components) {
      let maybeComponentReplicationState = this.componentReplicationStates.get(
        c.component.id.asNumericId()
      );
      if (maybeComponentReplicationState !== undefined) {
        if (
          byteArraysAreEqual(
            maybeComponentReplicationState.latestState.serializedData,
            c.serializedData
          )
        ) {
          maybeComponentReplicationState.ackState = AckState.ACKED;
        }
      }
    }
  }
}
