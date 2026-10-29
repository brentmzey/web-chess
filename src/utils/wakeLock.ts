import {
  failure,
  fromNullable,
  matchBool,
  none,
  some,
  success,
  type Option,
  type Result
} from './fp';

/**
 * Interface representing W3C WakeLockSentinel contract.
 */
export interface WakeLockSentinelLike extends EventTarget {
  readonly released: boolean;
  readonly type: 'screen';
  release(): Promise<void>;
  onrelease: ((this: WakeLockSentinelLike, ev: Event) => unknown) | null;
}

/**
 * Interface representing W3C WakeLock contract.
 */
export interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Minimal Navigator interface containing optional WakeLock.
 */
export interface NavigatorWithWakeLock {
  readonly wakeLock?: WakeLockLike;
}

/**
 * Minimal Document interface for visibility detection.
 */
export interface DocumentWithVisibility {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: string,
                   listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string,
                      listener: EventListenerOrEventListenerObject): void;
}

/**
 * Functional Screen Wake Lock Manager:
 * Manages the W3C Screen Wake Lock API to prevent the device display
 * from dimming or sleeping during active Sanctuary matches (Serious Eats / Cook Mode pattern).
 *
 * Automatically restores lock upon tab visibility restoration and manages
 * reactive state subscriptions.
 */
export class ScreenWakeLockManager {
  private sentinel: Option<WakeLockSentinelLike> = none();
  private requestedByUser: boolean = false;
  private readonly listeners: Set<(active: boolean) => void> = new Set();
  private readonly visibilityHandler: () => void;
  private readonly releaseHandler: () => void;

  constructor(private readonly nav: NavigatorWithWakeLock = typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorWithWakeLock) : {},
              private readonly doc: DocumentWithVisibility = typeof document !== 'undefined' ? (document as unknown as DocumentWithVisibility) : ({ visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} }),
              onStateChange?: (active: boolean) => void) {
    if (onStateChange) {
      this.listeners.add(onStateChange);
    }

    this.releaseHandler = () => {
      this.sentinel = none();
      this.notify(false);
    };

    this.visibilityHandler = () => {
      void this.handleVisibilityChange();
    };

    if (typeof this.doc.addEventListener === 'function') {
      this.doc.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /**
   * Checks whether the Screen Wake Lock API is supported by the current browser/runtime.
   */
  public isSupported(): boolean {
    return fromNullable(this.nav.wakeLock).fold(
      () => false,
      wl => typeof wl.request === 'function'
    );
  }

  /**
   * Returns true if a screen wake lock is currently active and unreleased.
   */
  public isActive(): boolean {
    return this.sentinel.fold(
      () => false,
      s => !s.released
    );
  }

  /**
   * Returns true if the user's intent is to keep the screen awake.
   */
  public isRequested(): boolean {
    return this.requestedByUser;
  }

  /**
   * Requests a screen wake lock from the browser.
   * If unsupported or rejected by permission/OS policy, returns a Failure with error.
   */
  public async request(): Promise<Result<boolean, Error>> {
    this.requestedByUser = true;

    return matchBool(this.isSupported(), {
      false: async () => failure(new Error('Screen Wake Lock API is not supported in this browser')),
      true: async () => {
        if (this.isActive()) {
          return success(true);
        }

        try {
          const wl = this.nav.wakeLock!;
          const sentinel = await wl.request('screen');
          this.sentinel = some(sentinel);

          if (typeof sentinel.addEventListener === 'function') {
            sentinel.addEventListener('release', this.releaseHandler);
          }

          this.notify(true);
          return success(true);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.sentinel = none();
          this.notify(false);
          return failure(error);
        }
      }
    });
  }

  /**
   * Releases the active screen wake lock if held.
   */
  public async release(): Promise<Result<boolean, Error>> {
    this.requestedByUser = false;

    return this.sentinel.fold(
      async () => success(false),
      async sentinel => {
        try {
          if (typeof sentinel.removeEventListener === 'function') {
            sentinel.removeEventListener('release', this.releaseHandler);
          }
          await sentinel.release();
        } catch {
          // Ignore release errors when already released
        } finally {
          this.sentinel = none();
          this.notify(false);
        }
        return success(false);
      }
    );
  }

  /**
   * Toggles the screen wake lock state between requested and released.
   */
  public async toggle(): Promise<Result<boolean, Error>> {
    return matchBool(this.isActive(), {
      true: async () => this.release(),
      false: async () => this.request()
    });
  }

  /**
   * Handles visibility changes: when the page returns to visible,
   * automatically re-acquires the wake lock if user intent was active.
   */
  public async handleVisibilityChange(): Promise<void> {
    if (this.doc.visibilityState === 'visible' && this.requestedByUser && !this.isActive()) {
      await this.request();
    }
  }

  /**
   * Subscribes a listener to wake lock activation state changes.
   * Returns an unsubscribe function.
   */
  public subscribe(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Cleans up all listeners and releases any held lock.
   */
  public destroy(): void {
    if (typeof this.doc.removeEventListener === 'function') {
      this.doc.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.listeners.clear();
    void this.release();
  }

  private notify(active: boolean): void {
    this.listeners.forEach(listener => {
      try {
        listener(active);
      } catch {
        // Prevent listener exceptions from breaking manager state
      }
    });
  }
}
