import { beforeEach, describe, expect, it } from 'bun:test';
import {
  BaseModal,
  ModalManager,
  PregameModal,
  PromotionModal,
  GameOverModal,
  StorageAuditModal,
  LiveSessionModal,
  ArcadeRulesModal,
  ArcadeHubModal,
  ArcadeTheaterModal,
  FloatingPanelModal
} from '../src/ui/baseModal';

class MockDOMElement {
  public tagName: string = 'DIV';
  public className: string = '';
  public parentNode: MockDOMElement | null = null;
  public children: MockDOMElement[] = [];
  public eventListeners: Record<string, ((e: any) => void)[]> = {};
  public attrs: Record<string, string> = {};

  public classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach(c => this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach(c => this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      const shouldAdd = force !== undefined ? force : !this.classList.classes.has(c);
      if (shouldAdd) {
        this.classList.classes.add(c);
      } else {
        this.classList.classes.delete(c);
      }
    }
  };

  public get firstElementChild(): MockDOMElement | null {
    return this.children.length > 0 ? this.children[0] : null;
  }

  public setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  public getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  public hasAttribute(name: string): boolean {
    return name in this.attrs;
  }

  public appendChild(child: MockDOMElement): MockDOMElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  public addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(listener);
  }

  public dispatchEvent(event: { type: string; [k: string]: any }): void {
    const listeners = this.eventListeners[event.type] ?? [];
    listeners.forEach(fn => fn(event));
  }

  public contains(target: any): boolean {
    if (target === this) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
  }

  public matches(selector: string): boolean {
    const selectors = selector.split(',').map(s => s.trim());
    return selectors.some(sel => {
      if (sel === '.md3-glass' && this.classList.contains('md3-glass')) return true;
      if (sel === '.arcade-theater-shell' && this.classList.contains('arcade-theater-shell')) return true;
      if (sel.includes('[data-modal-close]') && this.hasAttribute('data-modal-close')) return true;
      if (sel.includes('[data-modal-card]') && this.hasAttribute('data-modal-card')) return true;
      if (sel.startsWith('#') && this.attrs.id === sel.slice(1)) return true;
      if (sel.startsWith('.') && this.classList.contains(sel.slice(1))) return true;
      return false;
    });
  }

  public querySelector(selector: string): MockDOMElement | null {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  public querySelectorAll(selector: string): MockDOMElement[] {
    const matches: MockDOMElement[] = [];
    const selectors = selector.split(',').map(s => s.trim());
    const checkMatch = (el: MockDOMElement) => {
      const isMatch = selectors.some(sel => {
        if (sel === '.md3-glass' && el.classList.contains('md3-glass')) return true;
        if (sel === '.arcade-theater-shell' && el.classList.contains('arcade-theater-shell')) return true;
        if (sel.includes('[data-modal-close]') && el.hasAttribute('data-modal-close')) return true;
        if (sel.includes('[data-modal-card]') && el.hasAttribute('data-modal-card')) return true;
        if (sel.startsWith('#') && el.attrs.id === sel.slice(1)) return true;
        if (sel.startsWith('.') && el.classList.contains(sel.slice(1))) return true;
        return false;
      });
      if (isMatch) matches.push(el);
      el.children.forEach(checkMatch);
    };

    this.children.forEach(checkMatch);
    return matches;
  }
}

describe('BaseModal & ModalManager Inheritable Hierarchy', () => {
  let domRegistry: Record<string, MockDOMElement>;
  let windowListeners: Record<string, ((e: any) => void)[]>;

  beforeEach(() => {
    domRegistry = {};
    windowListeners = {};

    (globalThis as any).document = {
      getElementById: (id: string) => domRegistry[id] ?? null
    };

    (globalThis as any).window = {
      addEventListener: (type: string, listener: (e: any) => void) => {
        if (!windowListeners[type]) {
          windowListeners[type] = [];
        }
        windowListeners[type].push(listener);
      },
      dispatchEvent: (event: { type: string; [k: string]: any }) => {
        (windowListeners[event.type] ?? []).forEach(fn => fn(event));
      }
    };

    ModalManager.getInstance().clear();
  });

  const setupMockModal = (modalId: string,
                          closeBtnId: string,
                          hasDataModalClose: boolean = false): {
    modal: MockDOMElement;
    card: MockDOMElement;
    closeBtn: MockDOMElement;
  } => {
    const modal = new MockDOMElement();
    modal.attrs.id = modalId;
    modal.classList.add('hidden');

    const card = new MockDOMElement();
    card.classList.add('md3-glass');
    modal.appendChild(card);

    const closeBtn = new MockDOMElement();
    closeBtn.attrs.id = closeBtnId;
    if (hasDataModalClose) {
      closeBtn.setAttribute('data-modal-close', 'true');
    }
    card.appendChild(closeBtn);

    domRegistry[modalId] = modal;
    domRegistry[closeBtnId] = closeBtn;

    return { modal, card, closeBtn };
  };

  it('initializes BaseModal and discovers elements', () => {
    const { modal, card } = setupMockModal('test-modal', 'test-close-btn');
    expect(card.classList.contains('md3-glass')).toBe(true);

    class TestModal extends BaseModal {
      public constructor() {
        super('test-modal', {
          closeButtonSelectors: ['#test-close-btn', '.test-class-btn'],
          displayClass: 'flex'
        });
      }
    }

    const testModal = new TestModal();
    expect(testModal.modalId).toBe('test-modal');
    expect(testModal.modalEl.isSome()).toBe(true);
    expect(testModal.cardEl.isSome()).toBe(true);
    expect(testModal.isOpen()).toBe(false);

    testModal.show();
    expect(testModal.isOpen()).toBe(true);
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(modal.classList.contains('flex')).toBe(true);

    testModal.hide();
    expect(testModal.isOpen()).toBe(false);
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.classList.contains('flex')).toBe(false);
  });

  it('triggers onOpen and onClose callbacks', () => {
    setupMockModal('cb-modal', 'cb-close-btn');

    class CbModal extends BaseModal {
      public constructor() {
        super('cb-modal');
      }
    }

    const modal = new CbModal();
    let openCount = 0;
    let closeCount = 0;

    modal.onOpen(() => { openCount++; });
    modal.onClose(() => { closeCount++; });

    modal.show();
    expect(openCount).toBe(1);
    expect(closeCount).toBe(0);

    modal.hide();
    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
  });

  it('detects outside hit box clicks accurately', () => {
    const { modal, card } = setupMockModal('hitbox-modal', 'hitbox-close-btn');

    class HitBoxModal extends BaseModal {
      public constructor() {
        super('hitbox-modal');
      }
    }

    const hitBoxModal = new HitBoxModal();
    const outsideNode = new MockDOMElement();

    // Clicking on backdrop (modal element itself) is outside the card
    expect(hitBoxModal.isOutsideHitBox(modal as any)).toBe(true);
    expect(hitBoxModal.isOutsideHitBox(outsideNode as any)).toBe(true);

    // Clicking inside the card is NOT outside
    expect(hitBoxModal.isOutsideHitBox(card as any)).toBe(false);
  });

  it('handles fallback when card element is absent', () => {
    const modalNoCard = new MockDOMElement();
    modalNoCard.attrs.id = 'nocard-modal';
    domRegistry['nocard-modal'] = modalNoCard;

    class NoCardModal extends BaseModal {
      public constructor() {
        super('nocard-modal');
      }
    }

    const noCardModal = new NoCardModal();
    expect(noCardModal.cardEl.isNone()).toBe(true);
    expect(noCardModal.isOutsideHitBox(modalNoCard as any)).toBe(true);
    expect(noCardModal.isOutsideHitBox(new MockDOMElement() as any)).toBe(false);
  });

  it('falls back to firstElementChild when cardSelector does not match', () => {
    const modal = new MockDOMElement();
    modal.attrs.id = 'fallback-modal';
    const fallbackChild = new MockDOMElement();
    fallbackChild.classList.add('custom-container');
    modal.appendChild(fallbackChild);
    domRegistry['fallback-modal'] = modal;

    class FallbackModal extends BaseModal {
      public constructor() {
        super('fallback-modal', {
          cardSelector: '.non-existent-selector'
        });
      }
    }

    const fallbackModal = new FallbackModal();
    expect(fallbackModal.cardEl.getOrThrow()).toBe(fallbackChild as any);
  });

  it('closes modal when clicking outside hit box region', () => {
    const { modal, card } = setupMockModal('outside-modal', 'outside-close-btn');

    class OutsideModal extends BaseModal {
      public constructor() {
        super('outside-modal', {
          closeButtonSelectors: ['#outside-close-btn']
        });
      }
    }

    const instance = new OutsideModal();
    instance.attachInteractions();
    instance.show();
    expect(instance.isOpen()).toBe(true);

    // Click inside the card should not close it
    modal.dispatchEvent({ type: 'click', target: card });
    expect(instance.isOpen()).toBe(true);

    // Click on the backdrop (outside hit box) closes it
    modal.dispatchEvent({ type: 'click', target: modal });
    expect(instance.isOpen()).toBe(false);
  });

  it('closes modal when clicking close button or [data-modal-close]', () => {
    const { card, closeBtn } = setupMockModal('x-modal', 'x-close-btn', true);

    const classBtn = new MockDOMElement();
    classBtn.classList.add('generic-close-class');
    card.appendChild(classBtn);

    const duplicateDataCloseBtn = new MockDOMElement();
    duplicateDataCloseBtn.attrs.id = 'dup-btn';
    duplicateDataCloseBtn.setAttribute('data-modal-close', 'true');
    card.appendChild(duplicateDataCloseBtn);

    class XModal extends BaseModal {
      public constructor() {
        super('x-modal', {
          closeButtonSelectors: ['#x-close-btn', '.generic-close-class', '#dup-btn']
        });
      }
    }

    const instance = new XModal();
    instance.attachInteractions();
    instance.show();
    expect(instance.isOpen()).toBe(true);

    expect(instance.getCloseButtons().length).toBe(3);

    // Click on class-based button closes modal
    classBtn.dispatchEvent({ type: 'click' });
    expect(instance.isOpen()).toBe(false);

    instance.show();
    expect(instance.isOpen()).toBe(true);

    // Click on "X" button closes modal
    closeBtn.dispatchEvent({ type: 'click' });
    expect(instance.isOpen()).toBe(false);
  });

  it('closes modal when Escape key is pressed while open', () => {
    setupMockModal('esc-modal', 'esc-close-btn');

    class EscModal extends BaseModal {
      public constructor() {
        super('esc-modal');
      }
    }

    const instance = new EscModal();
    instance.attachInteractions();

    // Escape while closed does nothing
    (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(instance.isOpen()).toBe(false);

    instance.show();
    expect(instance.isOpen()).toBe(true);

    // Other keys do nothing
    (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Enter' });
    expect(instance.isOpen()).toBe(true);

    // Escape while open closes modal
    (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(instance.isOpen()).toBe(false);
  });

  it('attaches interactions only once (idempotent)', () => {
    setupMockModal('idem-modal', 'idem-close-btn');

    class IdemModal extends BaseModal {
      public constructor() {
        super('idem-modal');
      }
    }

    const instance = new IdemModal();
    expect(instance.attachInteractions()).toBe(instance);
    expect(instance.attachInteractions()).toBe(instance);
  });

  it('instantiates all concrete modal subclasses', () => {
    setupMockModal('pregame-modal', 'close-pregame-btn');
    setupMockModal('promotion-modal', 'close-promotion-btn');
    setupMockModal('gameover-modal', 'close-gameover-btn');
    setupMockModal('storage-audit-modal', 'close-audit-btn');
    setupMockModal('live-session-modal', 'close-live-session-btn');
    setupMockModal('arcade-rules-modal', 'btn-close-arcade-rules');
    setupMockModal('arcade-hub-modal', 'btn-close-arcade-hub');
    setupMockModal('blackjack-modal', 'btn-close-blackjack');
    setupMockModal('contrast-panel', 'close-contrast-btn');

    const pregame = new PregameModal();
    const promo = new PromotionModal();
    const gameover = new GameOverModal();
    const storageAudit = new StorageAuditModal();
    const liveSession = new LiveSessionModal();
    const rules = new ArcadeRulesModal();
    const hub = new ArcadeHubModal();
    const theater = new ArcadeTheaterModal('blackjack-modal', ['#btn-close-blackjack']);
    const panel = new FloatingPanelModal('contrast-panel', '#close-contrast-btn');

    expect(pregame.modalId).toBe('pregame-modal');
    expect(promo.modalId).toBe('promotion-modal');
    expect(gameover.modalId).toBe('gameover-modal');
    expect(storageAudit.modalId).toBe('storage-audit-modal');
    expect(liveSession.modalId).toBe('live-session-modal');
    expect(rules.modalId).toBe('arcade-rules-modal');
    expect(hub.modalId).toBe('arcade-hub-modal');
    expect(theater.modalId).toBe('blackjack-modal');
    expect(panel.modalId).toBe('contrast-panel');
  });

  it('respects closeOnOutsideClick=false and matches root element selector directly', () => {
    const theaterRoot = new MockDOMElement();
    theaterRoot.attrs.id = 'theater-modal';
    theaterRoot.classList.add('arcade-theater-shell');
    domRegistry['theater-modal'] = theaterRoot;

    const theaterModal = new ArcadeTheaterModal('theater-modal', ['#btn-close-theater']);
    theaterModal.show();
    expect(theaterModal.isOpen()).toBe(true);

    const outsideTarget = new MockDOMElement();
    expect(theaterModal.isOutsideHitBox(outsideTarget as any)).toBe(false);

    // Clicking outside hit box does NOT close theater modal when closeOnOutsideClick is false
    theaterRoot.dispatchEvent({ type: 'click', target: outsideTarget });
    expect(theaterModal.isOpen()).toBe(true);
  });

  it('manages modal registry via ModalManager', () => {
    setupMockModal('m1', 'c1');
    setupMockModal('m2', 'c2');

    class M1 extends BaseModal { public constructor() { super('m1'); } }
    class M2 extends BaseModal { public constructor() { super('m2'); } }

    const manager = ModalManager.getInstance();
    const m1 = manager.register(new M1());
    const m2 = manager.register(new M2());

    expect(manager.getModal('m1').getOrThrow()).toBe(m1);
    expect(manager.getModal('m2').getOrThrow()).toBe(m2);
    expect(manager.getModal('unknown').isNone()).toBe(true);
    expect(manager.getAllRegistered().length).toBe(2);

    expect(manager.isAnyModalOpen()).toBe(false);

    manager.show('m1');
    expect(m1.isOpen()).toBe(true);
    expect(manager.isAnyModalOpen()).toBe(true);

    manager.show('m2');
    expect(m2.isOpen()).toBe(true);

    manager.hide('m1');
    expect(m1.isOpen()).toBe(false);
    expect(m2.isOpen()).toBe(true);

    manager.hideAll();
    expect(m1.isOpen()).toBe(false);
    expect(m2.isOpen()).toBe(false);
    expect(manager.isAnyModalOpen()).toBe(false);
  });
});
