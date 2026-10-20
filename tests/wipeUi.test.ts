import { beforeEach, describe, expect, it } from 'bun:test';
import { UIController } from '../src/ui/uiController';

class El {
  public classList = {
    classes: new Set<string>(['hidden']),
    add: (...c: string[]) => c.forEach(x => this.classList.classes.add(x)),
    remove: (...c: string[]) => c.forEach(x => this.classList.classes.delete(x)),
    contains: (c: string) => this.classList.classes.has(c)
  };
}

describe('Wipe confirmation UI (two-step)', () => {
  let row: El;

  beforeEach(() => {
    row = new El();
    const modal = new El();
    (globalThis as any).document = {
      getElementById: (id: string) =>
        id === 'wipe-confirm-row' ? row : id === 'storage-audit-modal' ? modal : null
    };
  });

  it('shows the confirmation, hides it on cancel, and re-arms when the audit modal closes', () => {
    const ui = new UIController();
    expect(row.classList.contains('hidden')).toBe(true);

    ui.showWipeConfirm();
    expect(row.classList.contains('flex')).toBe(true);
    expect(row.classList.contains('hidden')).toBe(false);

    ui.hideWipeConfirm();
    expect(row.classList.contains('hidden')).toBe(true);

    ui.showWipeConfirm();
    ui.hideStorageAuditModal();
    expect(row.classList.contains('hidden')).toBe(true);
  });

  it('is a safe no-op when the confirmation row is absent', () => {
    (globalThis as any).document = { getElementById: () => null };
    const ui = new UIController();
    expect(() => {
      ui.showWipeConfirm();
      ui.hideWipeConfirm();
      ui.hideStorageAuditModal();
    }).not.toThrow();
  });
});
