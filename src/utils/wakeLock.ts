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
 * Minimal Document interface for visibility and element lookup.
 */
export interface DocumentWithVisibility {
  readonly visibilityState: DocumentVisibilityState;
  getElementById?(elementId: string): HTMLElement | null;
  addEventListener(type: string,
                   listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string,
                      listener: EventListenerOrEventListenerObject): void;
}

/**
 * Minimal Window interface for coordinate bounds, dispatching, and timing.
 */
export interface WindowWithMotion {
  readonly innerWidth?: number;
  readonly innerHeight?: number;
  setInterval?(handler: TimerHandler,
               timeout?: number): number;
  clearInterval?(id: number): void;
  dispatchEvent?(event: Event): boolean;
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
  private motionTimer: Option<number> = none();
  private currentCoord: Option<{ readonly x: number; readonly y: number }> = none();

  constructor(private readonly nav: NavigatorWithWakeLock = typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorWithWakeLock) : {},
              private readonly doc: DocumentWithVisibility = typeof document !== 'undefined' ? (document as unknown as DocumentWithVisibility) : ({ visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} }),
              onStateChange?: (active: boolean) => void,
              private readonly win: Option<WindowWithMotion> = fromNullable(typeof window !== 'undefined' ? (window as unknown as WindowWithMotion) : null)) {
    if (onStateChange) {
      this.listeners.add(onStateChange);
    }

    this.releaseHandler = () => {
      this.stopMotion();
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

  public getMotionElement(): Option<HTMLElement> {
    return fromNullable(this.doc.getElementById).flatMap(getEl =>
      fromNullable(getEl.call(this.doc, 'screen-wake-pointer'))
    );
  }

  public getViewportBounds(): { readonly width: number; readonly height: number } {
    return this.win
      .map(w => ({
        width: fromNullable(w.innerWidth).getOrElse(1280),
        height: fromNullable(w.innerHeight).getOrElse(800)
      }))
      .getOrElse({ width: 1280, height: 800 });
  }

  public nextMotionCoordinates(): { readonly x: number; readonly y: number } {
    const bounds = this.getViewportBounds();
    const margin = 32;
    const maxX = Math.max(margin, bounds.width - margin);
    const maxY = Math.max(margin, bounds.height - margin);

    return this.currentCoord.fold(
      () => {
        const initial = {
          x: Math.round(bounds.width * 0.45),
          y: Math.round(bounds.height * 0.45)
        };
        this.currentCoord = some(initial);
        return initial;
      },
      prev => {
        const deltaX = (Math.random() - 0.48) * 120;
        const deltaY = (Math.random() - 0.48) * 90;
        const nextX = Math.min(maxX, Math.max(margin, Math.round(prev.x + deltaX)));
        const nextY = Math.min(maxY, Math.max(margin, Math.round(prev.y + deltaY)));
        const next = { x: nextX, y: nextY };
        this.currentCoord = some(next);
        return next;
      }
    );
  }

  public stepMotion(): void {
    const coords = this.nextMotionCoordinates();

    this.getMotionElement().map(el => {
      el.classList.remove('hidden');
      el.style.transform = `translate3d(${coords.x}px, ${coords.y}px, 0)`;
    });

    this.win.map(w => {
      fromNullable(w.dispatchEvent).map(dispatch => {
        try {
          const evt = typeof MouseEvent !== 'undefined'
            ? new MouseEvent('mousemove', {
                clientX: coords.x,
                clientY: coords.y,
                bubbles: true
              })
            : new Event('mousemove');
          dispatch.call(w, evt);
        } catch {
          // Graceful fallback for non-DOM environments
        }
      });
    });
  }

  public startMotion(intervalMs: number = 2400): void {
    this.stopMotion();
    this.stepMotion();

    this.win.map(w => {
      fromNullable(w.setInterval).map(setIntervalFn => {
        const timerId = setIntervalFn.call(w, () => {
          this.stepMotion();
        }, intervalMs);
        this.motionTimer = some(timerId);
      });
    });
  }

  public stopMotion(): void {
    this.motionTimer.map(id => {
      this.win.map(w => {
        fromNullable(w.clearInterval).map(clearIntervalFn => {
          clearIntervalFn.call(w, id);
        });
      });
    });
    this.motionTimer = none();

    this.getMotionElement().map(el => {
      el.classList.add('hidden');
    });
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
          this.startMotion();
          return success(true);
        }

        try {
          const wl = this.nav.wakeLock!;
          const sentinel = await wl.request('screen');
          this.sentinel = some(sentinel);

          if (typeof sentinel.addEventListener === 'function') {
            sentinel.addEventListener('release', this.releaseHandler);
          }

          this.startMotion();
          this.notify(true);
          return success(true);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.sentinel = none();
          this.stopMotion();
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
    this.stopMotion();

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
    if (this.doc.visibilityState === 'visible') {
      if (this.requestedByUser && !this.isActive()) {
        await this.request();
      } else if (this.isActive()) {
        this.startMotion();
      }
    } else {
      this.stopMotion();
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
    this.stopMotion();
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
