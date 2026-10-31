import { beforeEach, describe, expect, it } from 'bun:test';
import {
  ScreenWakeLockManager,
  type DocumentWithVisibility,
  type NavigatorWithWakeLock,
  type WakeLockLike,
  type WakeLockSentinelLike
} from '../src/utils/wakeLock';

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

class MockDocument implements DocumentWithVisibility {
  public visibilityState: DocumentVisibilityState = 'visible';
  private readonly listeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

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

describe('ScreenWakeLockManager Functional Service (Cook Mode Display Wake Lock)', () => {
  let mockWl: MockWakeLock;
  let mockNav: NavigatorWithWakeLock;
  let mockDoc: MockDocument;

  beforeEach(() => {
    mockWl = new MockWakeLock();
    mockNav = { wakeLock: mockWl };
    mockDoc = new MockDocument();
  });

  it('detects when Screen Wake Lock API is not supported', async () => {
    const unsupportedNav: NavigatorWithWakeLock = {};
    const manager = new ScreenWakeLockManager(unsupportedNav, mockDoc);

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

  it('detects when wakeLock object exists but request is not a function', () => {
    const invalidNav: NavigatorWithWakeLock = { wakeLock: {} as any };
    const manager = new ScreenWakeLockManager(invalidNav, mockDoc);
    expect(manager.isSupported()).toBe(false);
  });

  it('successfully acquires and verifies active state with subscriber notifications', async () => {
    const stateNotifications: boolean[] = [];
    const manager = new ScreenWakeLockManager(
      mockNav,
      mockDoc,
      active => stateNotifications.push(active)
    );

    expect(manager.isSupported()).toBe(true);
    expect(manager.isActive()).toBe(false);

    const reqResult = await manager.request();
    expect(reqResult.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(true);
    expect(manager.isRequested()).toBe(true);
    expect(stateNotifications).toEqual([true]);

    // Subsequent request when already active returns true idempotently without duplicate requests
    const secondReq = await manager.request();
    expect(secondReq.isSuccess()).toBe(true);
    expect(stateNotifications).toEqual([true]);
  });

  it('handles sentinel without addEventListener gracefully upon request', async () => {
    const sentinelWithoutListener: WakeLockSentinelLike = {
      released: false,
      type: 'screen',
      release: async () => {},
      onrelease: null,
      addEventListener: undefined as any,
      removeEventListener: undefined as any,
      dispatchEvent: () => true
    };
    const customNav: NavigatorWithWakeLock = {
      wakeLock: {
        request: async () => sentinelWithoutListener
      }
    };
    const manager = new ScreenWakeLockManager(customNav, mockDoc);
    const res = await manager.request();
    expect(res.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(true);
  });

  it('releases screen wake lock cleanly and notifies listeners', async () => {
    const stateNotifications: boolean[] = [];
    const manager = new ScreenWakeLockManager(mockNav, mockDoc);
    const unsubscribe = manager.subscribe(active => stateNotifications.push(active));

    await manager.request();
    expect(manager.isActive()).toBe(true);

    const relResult = await manager.release();
    expect(relResult.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(false);
    expect(manager.isRequested()).toBe(false);
    expect(stateNotifications).toEqual([true, false]);

    // Releasing again when inactive is idempotent
    const relSecond = await manager.release();
    expect(relSecond.isSuccess()).toBe(true);

    unsubscribe();
    await manager.request();
    expect(stateNotifications).toEqual([true, false]); // Listener unsubscribed
  });

  it('swallows and cleans up sentinel release exceptions gracefully', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc);
    await manager.request();
    expect(manager.isActive()).toBe(true);

    mockWl.lastCreatedSentinel!.release = async () => {
      throw new Error('OS release exception');
    };

    const relRes = await manager.release();
    expect(relRes.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(false);
  });

  it('handles sentinel without removeEventListener gracefully on release', async () => {
    const customSentinel: WakeLockSentinelLike = {
      released: false,
      type: 'screen',
      release: async () => {},
      onrelease: null,
      addEventListener: () => {},
      removeEventListener: undefined as any,
      dispatchEvent: () => true
    };
    const customNav: NavigatorWithWakeLock = {
      wakeLock: {
        request: async () => customSentinel
      }
    };
    const manager = new ScreenWakeLockManager(customNav, mockDoc);
    await manager.request();
    expect(manager.isActive()).toBe(true);

    const relRes = await manager.release();
    expect(relRes.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(false);
  });

  it('handles toggle() between active and released states', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc);

    // Toggle 1: OFF -> ON
    const toggleOn = await manager.toggle();
    expect(toggleOn.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(true);

    // Toggle 2: ON -> OFF
    const toggleOff = await manager.toggle();
    expect(toggleOff.isSuccess()).toBe(true);
    expect(manager.isActive()).toBe(false);
  });

  it('automatically handles external sentinel release events', async () => {
    const stateNotifications: boolean[] = [];
    const manager = new ScreenWakeLockManager(
      mockNav,
      mockDoc,
      active => stateNotifications.push(active)
    );

    await manager.request();
    expect(manager.isActive()).toBe(true);

    // Simulate browser / OS releasing the sentinel (e.g. low battery / backgrounding)
    await mockWl.lastCreatedSentinel!.release();

    expect(manager.isActive()).toBe(false);
    expect(stateNotifications).toEqual([true, false]);
  });

  it('auto-restores wake lock on document visibilitychange when visible and previously requested', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc);

    await manager.request();
    expect(manager.isActive()).toBe(true);

    // Simulate tab hidden -> OS releases sentinel
    mockDoc.visibilityState = 'hidden';
    mockDoc.triggerVisibilityChange('hidden');

    await mockWl.lastCreatedSentinel!.release();
    expect(manager.isActive()).toBe(false);
    expect(manager.isRequested()).toBe(true);

    // Document visible visibilitychange auto-re-requests
    mockDoc.visibilityState = 'visible';
    await manager.handleVisibilityChange();

    expect(manager.isActive()).toBe(true);
  });

  it('does NOT auto-restore wake lock on visibilitychange if user explicitly released it or tab is hidden', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc);

    await manager.request();
    await manager.release();
    expect(manager.isRequested()).toBe(false);

    mockDoc.triggerVisibilityChange('visible');
    await Promise.resolve();

    expect(manager.isActive()).toBe(false);

    // When hidden, handleVisibilityChange does nothing
    mockDoc.visibilityState = 'hidden';
    await manager.handleVisibilityChange();
    expect(manager.isActive()).toBe(false);
  });

  it('does NOT duplicate request on visibilitychange if already active', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc);
    await manager.request();
    expect(manager.isActive()).toBe(true);

    mockDoc.visibilityState = 'visible';
    await manager.handleVisibilityChange();
    expect(manager.isActive()).toBe(true);
  });

  it('catches and reports wakeLock.request rejection gracefully', async () => {
    mockWl.shouldReject = true;
    mockWl.rejectError = new Error('Device policy forbids display wake lock');

    const stateNotifications: boolean[] = [];
    const manager = new ScreenWakeLockManager(
      mockNav,
      mockDoc,
      active => stateNotifications.push(active)
    );

    const res = await manager.request();
    expect(res.isFailure()).toBe(true);
    res.match({
      Ok: () => expect().fail('Should not succeed'),
      Err: err => expect(err.message).toContain('Device policy forbids display wake lock')
    });

    expect(manager.isActive()).toBe(false);
    expect(stateNotifications).toEqual([false]);
  });

  it('catches non-Error thrown objects during request', async () => {
    mockWl.request = async () => {
      throw 'Plain string rejection';
    };

    const manager = new ScreenWakeLockManager(mockNav, mockDoc);
    const res = await manager.request();
    expect(res.isFailure()).toBe(true);
    res.match({
      Ok: () => expect().fail('Should fail'),
      Err: err => expect(err.message).toBe('Plain string rejection')
    });
  });

  it('cleans up event listeners and releases sentinel upon destroy()', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc);
    await manager.request();
    expect(manager.isActive()).toBe(true);

    manager.destroy();
    expect(manager.isActive()).toBe(false);

    // Triggering visibilitychange after destroy does nothing
    mockDoc.triggerVisibilityChange('visible');
    await Promise.resolve();
    expect(manager.isActive()).toBe(false);
  });

  it('handles documents without removeEventListener on destroy()', () => {
    const noRemoveDoc: DocumentWithVisibility = {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: undefined as any
    };
    const manager = new ScreenWakeLockManager(mockNav, noRemoveDoc);
    expect(() => manager.destroy()).not.toThrow();
  });

  it('is resilient against listener exceptions in notify()', async () => {
    const manager = new ScreenWakeLockManager(mockNav, mockDoc);
    manager.subscribe(() => {
      throw new Error('Exploding listener');
    });

    // Should not throw even when a listener throws
    const res = await manager.request();
    expect(res.isSuccess()).toBe(true);
  });

  it('instantiates safely with fallback / default constructor args', () => {
    const emptyDoc: DocumentWithVisibility = {
      visibilityState: 'visible',
      addEventListener: undefined as any,
      removeEventListener: () => {}
    };
    const manager = new ScreenWakeLockManager({}, emptyDoc);
    expect(typeof manager.isSupported).toBe('function');
    expect(typeof manager.isActive).toBe('function');
    expect(manager.isActive()).toBe(false);
  });
});
