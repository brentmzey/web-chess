import {
  type Option,
  fromNullable,
  domById,
  none,
  some
} from '../utils/fp';

export interface BaseModalOptions {
  readonly cardSelector?: string;
  readonly closeButtonSelectors?: readonly string[];
  readonly displayClass?: string;
  readonly hiddenClass?: string;
  readonly closeOnOutsideClick?: boolean;
  readonly closeOnEscape?: boolean;
}

/**
 * Reusable, inheritable base modal controller establishing consistent closing
 * behavior across all Sanctuary UI modals (click 'X', click outside hit box, or ESC key).
 */
export class BaseModal {
  public readonly modalId: string;
  public readonly modalEl: Option<HTMLElement>;
  public readonly cardEl: Option<HTMLElement>;
  protected readonly options: Readonly<BaseModalOptions>;
  private onCloseCallbacks: readonly (() => void)[] = [];
  private onOpenCallbacks: readonly (() => void)[] = [];
  private isAttached: boolean = false;

  public constructor(modalId: string,
                     options: Readonly<BaseModalOptions> = {}) {
    this.modalId = modalId;
    this.options = Object.freeze({ ...options });
    this.modalEl = domById(modalId);
    this.cardEl = this.modalEl.flatMap(el => {
      const defaultSelector = '.md3-glass, .arcade-theater-shell, [data-modal-card]';
      const selector = this.options.cardSelector ?? defaultSelector;
      if (typeof el.matches === 'function' && el.matches(selector)) {
        return some(el);
      }
      return fromNullable(el.querySelector(selector) as HTMLElement | null).fold(
        () => fromNullable(el.firstElementChild as HTMLElement | null),
        card => some(card)
      );
    });
  }

  public show(): void {
    this.onBeforeShow();
    this.modalEl.map(el => {
      const hiddenCls = this.options.hiddenClass ?? 'hidden';
      const displayCls = this.options.displayClass ?? 'flex';
      el.classList.remove(hiddenCls);
      if (displayCls && !el.classList.contains(displayCls)) {
        el.classList.add(displayCls);
      }
    });
    this.onAfterShow();
    this.onOpenCallbacks.forEach(cb => cb());
  }

  public hide(): void {
    this.onBeforeHide();
    this.modalEl.map(el => {
      const hiddenCls = this.options.hiddenClass ?? 'hidden';
      const displayCls = this.options.displayClass ?? 'flex';
      el.classList.add(hiddenCls);
      if (displayCls) {
        el.classList.remove(displayCls);
      }
    });
    this.onAfterHide();
    this.onCloseCallbacks.forEach(cb => cb());
  }

  public isOpen(): boolean {
    const hiddenCls = this.options.hiddenClass ?? 'hidden';
    return this.modalEl
      .map(el => !el.classList.contains(hiddenCls))
      .getOrElse(false);
  }

  public onClose(callback: () => void): this {
    this.onCloseCallbacks = [...this.onCloseCallbacks, callback];
    return this;
  }

  public onOpen(callback: () => void): this {
    this.onOpenCallbacks = [...this.onOpenCallbacks, callback];
    return this;
  }

  /**
   * Evaluates whether a given event target node lies strictly outside the modal's
   * internal card / interactive hit box region.
   */
  public isOutsideHitBox(target: Node): boolean {
    if (this.options.closeOnOutsideClick === false) {
      return false;
    }
    return this.cardEl.fold(
      () => this.modalEl.fold(() => false, el => el === target),
      card => !card.contains(target)
    );
  }

  /**
   * Binds root modal interactions: outside-card click, close 'X' buttons, and Escape key.
   */
  public attachInteractions(): this {
    if (this.isAttached) {
      return this;
    }
    this.isAttached = true;

    const closeOnOutside = this.options.closeOnOutsideClick ?? true;
    const closeOnEsc = this.options.closeOnEscape ?? true;

    // 1. Outside "hit box region" backdrop click listener
    if (closeOnOutside) {
      this.modalEl.map(modal => {
        modal.addEventListener('click', (e: MouseEvent) => {
          const target = e.target as Node;
          if (this.isOutsideHitBox(target)) {
            this.hide();
          }
        });
      });
    }

    // 2. Click listeners on all discovered "X" close buttons
    this.getCloseButtons().forEach(btn => {
      btn.addEventListener('click', () => {
        this.hide();
      });
    });

    // 3. Global Escape key handling when this modal is open
    if (closeOnEsc && typeof window !== 'undefined') {
      window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.isOpen()) {
          this.hide();
        }
      });
    }

    return this;
  }

  /**
   * Queries and returns all close buttons configured for this modal or matching [data-modal-close].
   */
  public getCloseButtons(): readonly HTMLElement[] {
    const buttons: HTMLElement[] = [];
    const selectors = this.options.closeButtonSelectors ?? [];

    this.modalEl.map(modal => {
      selectors.forEach(sel => {
        if (sel.startsWith('#')) {
          domById(sel.slice(1)).map(el => {
            if (!buttons.includes(el)) {
              buttons.push(el);
            }
          });
        } else {
          modal.querySelectorAll(sel).forEach(node => {
            const el = node as HTMLElement;
            if (!buttons.includes(el)) {
              buttons.push(el);
            }
          });
        }
      });

      modal.querySelectorAll('[data-modal-close]').forEach(node => {
        const el = node as HTMLElement;
        if (!buttons.includes(el)) {
          buttons.push(el);
        }
      });
    });

    return Object.freeze(buttons);
  }

  protected onBeforeShow(): void {}
  protected onAfterShow(): void {}
  protected onBeforeHide(): void {}
  protected onAfterHide(): void {}
}

/**
 * Concrete Pregame Match Setup Modal.
 */
export class PregameModal extends BaseModal {
  public constructor() {
    super('pregame-modal', {
      closeButtonSelectors: ['#close-pregame-btn'],
      displayClass: 'flex'
    });
  }
}

/**
 * Concrete Pawn Promotion Modal with top-right 'X' close button and backdrop cancel.
 */
export class PromotionModal extends BaseModal {
  public constructor() {
    super('promotion-modal', {
      closeButtonSelectors: ['#close-promotion-btn'],
      displayClass: 'flex'
    });
  }
}

/**
 * Concrete Game Over / Checkmate Modal with top-right 'X' and inspect board dismiss.
 */
export class GameOverModal extends BaseModal {
  public constructor() {
    super('gameover-modal', {
      closeButtonSelectors: ['#close-gameover-btn', '#modal-inspect', '#modal-inspect-live'],
      displayClass: 'flex'
    });
  }
}

/**
 * Concrete Encrypted Storage Audit Modal.
 */
export class StorageAuditModal extends BaseModal {
  public constructor() {
    super('storage-audit-modal', {
      closeButtonSelectors: ['#close-audit-btn'],
      displayClass: 'flex'
    });
  }
}

/**
 * Concrete Live Multiplayer Session Hub Modal.
 */
export class LiveSessionModal extends BaseModal {
  public constructor() {
    super('live-session-modal', {
      closeButtonSelectors: ['#close-live-session-btn'],
      displayClass: 'flex'
    });
  }
}

/**
 * Concrete Universal Arcade Rules & Real-Life Guide Modal.
 */
export class ArcadeRulesModal extends BaseModal {
  public constructor() {
    super('arcade-rules-modal', {
      closeButtonSelectors: ['#btn-close-arcade-rules', '#btn-dismiss-arcade-rules'],
      displayClass: 'flex'
    });
  }
}

/**
 * Concrete Sanctuary Arcade Suite Hub Modal.
 */
export class ArcadeHubModal extends BaseModal {
  public constructor() {
    super('arcade-hub-modal', {
      closeButtonSelectors: ['#btn-close-arcade-hub'],
      displayClass: 'flex'
    });
  }
}

/**
 * Concrete Arcade Theater Full-Screen Modal (Blackjack, Poker, Skip-Bo, Phase 10, Uno, Avalon, Set).
 */
export class ArcadeTheaterModal extends BaseModal {
  public constructor(gameModalId: string,
                     closeButtonIds: readonly string[]) {
    super(gameModalId, {
      closeButtonSelectors: closeButtonIds,
      displayClass: 'flex',
      closeOnOutsideClick: false
    });
  }
}

/**
 * Concrete Floating Panel Modal (Contrast / Clarity Panel).
 */
export class FloatingPanelModal extends BaseModal {
  public constructor(panelId: string,
                     closeButtonId: string) {
    super(panelId, {
      closeButtonSelectors: [closeButtonId],
      displayClass: 'block'
    });
  }
}

/**
 * Universal Modal Manager managing the lifecycle, registration, and mass dismissal
 * of all application dialogs and theaters.
 */
export class ModalManager {
  private static instance: Option<ModalManager> = none();
  private readonly modals: Map<string, BaseModal> = new Map();

  public static getInstance(): ModalManager {
    return ModalManager.instance.fold(
      () => {
        const mgr = new ModalManager();
        ModalManager.instance = some(mgr);
        return mgr;
      },
      mgr => mgr
    );
  }

  public register<T extends BaseModal>(modal: T): T {
    this.modals.set(modal.modalId, modal);
    modal.attachInteractions();
    return modal;
  }

  public getModal<T extends BaseModal = BaseModal>(modalId: string): Option<T> {
    return fromNullable(this.modals.get(modalId) as T | undefined);
  }

  public hide(modalId: string): void {
    this.getModal(modalId).map(m => m.hide());
  }

  public show(modalId: string): void {
    this.getModal(modalId).map(m => m.show());
  }

  public hideAll(): void {
    this.modals.forEach(m => m.hide());
  }

  public isAnyModalOpen(): boolean {
    for (const modal of this.modals.values()) {
      if (modal.isOpen()) {
        return true;
      }
    }
    return false;
  }

  public getAllRegistered(): readonly BaseModal[] {
    return Object.freeze(Array.from(this.modals.values()));
  }

  public clear(): void {
    this.modals.clear();
  }
}
