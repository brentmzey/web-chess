import { beforeEach, describe, expect, it } from 'bun:test';
import {
  ScreenWakeLockManager,
  type DocumentWithVisibility,
  type NavigatorWithWakeLock,
  type WakeLockLike,
  type WakeLockSentinelLike,
  type WindowWithMotion
} from '../src/utils/wakeLock';
import { none, some } from '../src/utils/fp';

class MockWakeLockSentinel extends EventTarget implements WakeLockSentinelLike {
  public released: boolean = false;
  public readonly type = 'screen' as const;
  public onrelease: ((this: WakeLockSentinelLike, ev: Event) => unknown) | null = null;

  public async release(): Promise<void> {
    this.released = true;
    const event = new Event('release');
    if (this.onrelease) {
      this.onrelease.call(this, event);
    }
    this.dispatchEvent(event);
  }
}

class MockWakeLock implements WakeLockLike {
  public shouldReject: boolean = false;
  public rejectError: Error = new Error('Wake lock permission denied');
  public lastCreatedSentinel: MockWakeLockSentinel | null = null;

  public async request(type: 'screen'): Promise<WakeLockSentinelLike> {
    if (type !== 'screen') {
      throw new Error(`Unsupported type: ${type}`);
    }
    if (this.shouldReject) {
      throw this.rejectError;
    }
    const sentinel = new MockWakeLockSentinel();
    this.lastCreatedSentinel = sentinel;
    return sentinel;
  }
}

class MockMotionElement {
  public classList = {
    classes: new Set<string>(['hidden']),
    add: (...cls: string[]) => cls.forEach(c => this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach(c => this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c)
  };
  public style: Record<string, string> = {};
}

class MockDocument implements DocumentWithVisibility {
  public visibilityState: DocumentVisibilityState = 'visible';
  public elements: Map<string, any> = new Map();
  private readonly listeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

  public getElementById(id: string): any {
    return this.elements.get(id) ?? null;
  }

  public addEventListener(type: string,
                          listener: EventListenerOrEventListenerObject): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string,
                             listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  public triggerVisibilityChange(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    const event = new Event('visibilitychange');
    const handlers = this.listeners.get('visibilitychange');
    if (handlers) {
      handlers.forEach(handler => {
        if (typeof handler === 'function') {
          handler(event);
        } else {
          handler.handleEvent(event);
        }
      });
    }
  }
}

class MockWindow implements WindowWithMotion {
  public innerWidth: number = 1024;
  public innerHeight: number = 768;
  public intervals: Map<number, { fn: () => void; timeout?: number }> = new Map();
  public nextId: number = 1;
  public dispatchedEvents: Event[] = [];

  public setInterval(handler: TimerHandler, timeout?: number): number {
    const id = this.nextId++;
    if (typeof handler === 'function') {
      this.intervals.set(id, { fn: handler as () => void, timeout });
    }
    return id;
  }

  public clearInterval(id: number): void {
    this.intervals.delete(id);
  }

  public dispatchEvent(event: Event): boolean {
    this.dispatchedEvents.push(event);
    return true;
  }

  public tickAllIntervals(): void {
    this.intervals.forEach(item => item.fn());
  }
}

describe('ScreenWakeLockManager Functional Service (Serious Eats / Recipe Cook Mode)', () => {
  let mockWl: MockWakeLock;
  let mockNav: NavigatorWithWakeLock;
  let mockDoc: MockDocument;
  let mockWin: MockWindow;
  let mockElement: MockMotionElement;

  beforeEach(() => {
    mockWl = new MockWakeLock();
    mockNav = { wakeLock: mockWl };
    mockDoc = new MockDocument();
    mockWin = new MockWindow();
    mockElement = new MockMotionElement();
    mockDoc.elements.set('screen-wake-pointer', mockElement);
  });

  it('detects when Screen Wake Lock API is not supported', async () => {
    const unsupportedNav: NavigatorWithWakeLock = {};
    const manager = new ScreenWakeLockManager(unsupportedNav, mockDoc, undefined, some(mockWin));

    expect(manager.isSupported()).toBe(false);
    expect(manager.isActive()).toBe(false);
    expect(manager.isRequested()).toBe(false);

    const reqResult = await manager.request();
    expect(reqResult.isFailure()).toBe(true);
    reqResult.match({
      Ok: () => expect().fail('Should have failed'),
      Err: err => expect(err.message).toContain('not supported')
    });

    const toggleResult = await manager.toggle();
    expect(toggleResult.isFailure()).toBe(true);
  });

  it('successfully acquires, verifies active state, and activates pointer motion', async () => {
    const stateNotifications: boolean[] = [];
    const manager = new ScreenWakeLockManager(
      mockNav,
      mockDoc,
      active => stateNotifications.push(active),
      some(mockWin)
    );

    expect(manager.isSupported()).toBe(true);
    expect(manager.isActive()).toBe(false);

    const reqResult = await manager.request();
    expect(reqResult.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(true);
    expect(manager.isRequested()).toBe(true);
    expect(stateNotifications).toEqual([true]);

    // Motion element is revealed and positioned
    expect(mockElement.classList.contains('hidden')).toBe(false);
    expect(mockElement.style.transform).toContain('translate3d');
    expect(mockWin.dispatchedEvents.length).toBeGreaterThan(0);
    expect(mockWin.intervals.size).toBe(1);

    // Subsequent tick updates coordinates and dispatches event
    const prevTransform = mockElement.style.transform;
    expect(prevTransform).toContain('translate3d');
    mockWin.tickAllIntervals();
    expect(mockElement.style.transform).toBeDefined();

    // Subsequent request when already active returns true idempotently
    const secondReq = await manager.request();
    expect(secondReq.isSuccess()).toBe(true);
    expect(stateNotifications).toEqual([true]);
  });

  it('releases screen wake lock cleanly, stops pointer motion, and notifies listeners', async () => {
    const stateNotifications: boolean[] = [];
    const manager = new ScreenWakeLockManager(
      mockNav,
      mockDoc,
      undefined,
      some(mockWin)
    );
    const unsubscribe = manager.subscribe(active => stateNotifications.push(active));

    await manager.request();
    expect(manager.isActive()).toBe(true);
    expect(mockElement.classList.contains('hidden')).toBe(false);
    expect(mockWin.intervals.size).toBe(1);

    const relResult = await manager.release();
    expect(relResult.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(false);
    expect(manager.isRequested()).toBe(false);
    expect(stateNotifications).toEqual([true, false]);
    expect(mockElement.classList.contains('hidden')).toBe(true);
    expect(mockWin.intervals.size).toBe(0);

    // Releasing again when inactive is idempotent
    const relSecond = await manager.release();
    expect(relSecond.isSuccess()).toBe(true);

    unsubscribe();
    await manager.request();
    expect(stateNotifications).toEqual([true, false]); // Listener stopped receiving
  });

  it('swallows and cleans up sentinel release exceptions gracefully', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));
    await manager.request();
    expect(manager.isActive()).toBe(true);

    mockWl.lastCreatedSentinel!.release = async () => {
      throw new Error('OS release exception');
    };

    const relRes = await manager.release();
    expect(relRes.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(false);
  });

  it('handles toggle() between active and released states', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));

    // Toggle 1: OFF -> ON
    const toggleOn = await manager.toggle();
    expect(toggleOn.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(true);
    expect(mockElement.classList.contains('hidden')).toBe(false);

    // Toggle 2: ON -> OFF
    const toggleOff = await manager.toggle();
    expect(toggleOff.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(false);
    expect(mockElement.classList.contains('hidden')).toBe(true);
  });

  it('automatically handles external sentinel release events and halts motion', async () => {
    const stateNotifications: boolean[] = [];
    const manager = new ScreenWakeLockManager(
      mockNav,
      mockDoc,
      active => stateNotifications.push(active),
      some(mockWin)
    );

    await manager.request();
    expect(manager.isActive()).toBe(true);
    expect(mockElement.classList.contains('hidden')).toBe(false);

    // Simulate browser / OS releasing the sentinel (e.g. low battery / backgrounding)
    await mockWl.lastCreatedSentinel!.release();

    expect(manager.isActive()).toBe(false);
    expect(stateNotifications).toEqual([true, false]);
    expect(mockElement.classList.contains('hidden')).toBe(true);
  });

  it('auto-restores wake lock and motion on document visibilitychange when visible and previously requested', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));

    await manager.request();
    expect(manager.isActive()).toBe(true);

    // Simulate tab hidden -> halts motion and OS releases sentinel
    mockDoc.visibilityState = 'hidden';
    mockDoc.triggerVisibilityChange('hidden');
    expect(mockElement.classList.contains('hidden')).toBe(true);

    await mockWl.lastCreatedSentinel!.release();
    expect(manager.isActive()).toBe(false);
    expect(manager.isRequested()).toBe(true);

    // Document visible visibilitychange auto-re-requests
    mockDoc.visibilityState = 'visible';
    await manager.handleVisibilityChange();

    expect(manager.isActive()).toBe(true);
    expect(mockElement.classList.contains('hidden')).toBe(false);

    // Request when already active returns success and maintains motion
    const dupReq = await manager.request();
    expect(dupReq.isSuccess()).toBe(true);
  });

  it('resumes motion if visibility changes to visible when already active', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));
    await manager.request();
    expect(manager.isActive()).toBe(true);

    // Stop motion directly
    manager.stopMotion();
    expect(mockElement.classList.contains('hidden')).toBe(true);

    // Visibility change while active restarts motion
    mockDoc.visibilityState = 'visible';
    await manager.handleVisibilityChange();
    expect(mockElement.classList.contains('hidden')).toBe(false);
  });

  it('does NOT auto-restore wake lock on visibilitychange if user explicitly released it', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));

    await manager.request();
    await manager.release();
    expect(manager.isRequested()).toBe(false);

    mockDoc.triggerVisibilityChange('visible');
    await Promise.resolve();

    expect(manager.isActive()).toBe(false);
    expect(mockElement.classList.contains('hidden')).toBe(true);
  });

  it('catches and reports wakeLock.request rejection gracefully and stops motion', async () => {
    mockWl.shouldReject = true;
    mockWl.rejectError = new Error('Device policy forbids display wake lock');

    const stateNotifications: boolean[] = [];
    const manager = new ScreenWakeLockManager(
      mockNav,
      mockDoc,
      active => stateNotifications.push(active),
      some(mockWin)
    );

    const res = await manager.request();
    expect(res.isFailure()).toBe(true);
    res.match({
      Ok: () => expect().fail('Should not succeed'),
      Err: err => expect(err.message).toContain('Device policy forbids display wake lock')
    });

    expect(manager.isActive()).toBe(false);
    expect(stateNotifications).toEqual([false]);
    expect(mockElement.classList.contains('hidden')).toBe(true);
  });

  it('catches non-Error thrown objects during request', async () => {
    mockWl.request = async () => {
      throw 'Plain string rejection';
    };

    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));
    const res = await manager.request();
    expect(res.isFailure()).toBe(true);
    res.match({
      Ok: () => expect().fail('Should fail'),
      Err: err => expect(err.message).toBe('Plain string rejection')
    });
  });

  it('cleans up event listeners, stops motion, and releases sentinel upon destroy()', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));
    await manager.request();
    expect(manager.isActive()).toBe(true);
    expect(mockElement.classList.contains('hidden')).toBe(false);

    manager.destroy();
    expect(manager.isActive()).toBe(false);
    expect(mockElement.classList.contains('hidden')).toBe(true);

    // Triggering visibilitychange after destroy does nothing
    mockDoc.triggerVisibilityChange('visible');
    await Promise.resolve();
    expect(manager.isActive()).toBe(false);
  });

  it('is resilient against listener exceptions in notify()', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));
    manager.subscribe(() => {
      throw new Error('Exploding listener');
    });

    // Should not throw even when a listener throws
    const res = await manager.request();
    expect(res.isSuccess()).toBe(true);
  });

  it('instantiates safely with fallback / default constructor args and handles absent motion element', () => {
    const emptyDoc: DocumentWithVisibility = {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: () => {}
    };
    const manager = new ScreenWakeLockManager({}, emptyDoc, undefined, none());
    expect(typeof manager.isSupported).toBe('function');
    expect(typeof manager.isActive).toBe('function');
    expect(manager.isActive()).toBe(false);

    // Motion steps gracefully with no window and no element
    manager.stepMotion();
    expect(manager.getViewportBounds()).toEqual({ width: 1280, height: 800 });
  });

  it('handles window dispatch errors gracefully in stepMotion', () => {
    const throwingWin: WindowWithMotion = {
      innerWidth: 500,
      innerHeight: 400,
      dispatchEvent: () => {
        throw new Error('Dispatch error');
      }
    };
    const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(throwingWin));
    // Should not throw
    manager.stepMotion();
  });

  it('constructs MouseEvent when MouseEvent constructor is available in global scope', () => {
    const originalMouseEvent = (globalThis as any).MouseEvent;
    try {
      (globalThis as any).MouseEvent = class MockMouseEvent extends Event {
        public clientX: number;
        public clientY: number;
        constructor(type: string, init?: any) {
          super(type);
          this.clientX = init?.clientX ?? 0;
          this.clientY = init?.clientY ?? 0;
        }
      };

      const manager = new ScreenWakeLockManager(mockNav, mockDoc, undefined, some(mockWin));
      manager.stepMotion();
      expect(mockWin.dispatchedEvents.length).toBeGreaterThan(0);
    } finally {
      (globalThis as any).MouseEvent = originalMouseEvent;
    }
  });
});
