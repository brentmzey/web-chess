import { beforeEach, describe, expect, it } from 'bun:test';
import { isEmojiOnlyMessage, renderChatMessageMarkup, UIController } from '../src/ui/uiController';

class MockElement {
  public className: string = '';
  public textContent: string = '';
  public innerHTML: string = '';
  public title: string = '';
  public value: string = '';
  public scrollTop: number = 0;
  public scrollHeight: number = 200;
  public attrs: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  public focused: boolean = false;
  public children: MockElement[] = [];

  public classList = {
    classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach(c => this.classList.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach(c => this.classList.classes.delete(c)),
    contains: (c: string) => this.classList.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      const shouldAdd = force !== undefined ? force : !this.classList.classes.has(c);
      if (shouldAdd) this.classList.classes.add(c);
      else this.classList.classes.delete(c);
    }
  };

  public setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }

  public getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }

  public focus() {
    this.focused = true;
  }

  public appendChild(child: MockElement) {
    this.children.push(child);
  }
}

describe('Sanctuary Live Chat UI Controller Testing', () => {
  let domElements: Record<string, MockElement>;
  let ui: UIController;

  beforeEach(() => {
    domElements = {
      'live-chat-drawer': new MockElement(),
      'btn-persistent-toggle-chat': new MockElement(),
      'chat-unread-badge': new MockElement(),
      'chat-session-code-badge': new MockElement(),
      'chat-current-player-name': new MockElement(),
      'chat-current-player-role': new MockElement(),
      'chat-messages-container': new MockElement(),
      'chat-empty-notice': new MockElement(),
      'chat-input': new MockElement(),
      'chat-char-counter': new MockElement(),
      'btn-send-chat': new MockElement(),
      'btn-close-chat': new MockElement()
    };

    // Initially hide chat drawer with sanctuary off-canvas class
    domElements['live-chat-drawer']!.classList.add('translate-x-[115%]');

    globalThis.document = {
      getElementById: (id: string) => (domElements[id] as any) || null,
      createElement: () => new MockElement(),
      querySelectorAll: () => []
    } as any;

    ui = new UIController();
  });

  it('toggles chat drawer visibility and reports state correctly', () => {
    expect(ui.isChatDrawerOpen()).toBe(false);

    // Open chat drawer explicitly
    ui.toggleChatDrawer(true);
    expect(ui.isChatDrawerOpen()).toBe(true);
    expect(domElements['live-chat-drawer']!.classList.contains('translate-x-[115%]')).toBe(false);

    // Close chat drawer explicitly
    ui.toggleChatDrawer(false);
    expect(ui.isChatDrawerOpen()).toBe(false);
    expect(domElements['live-chat-drawer']!.classList.contains('translate-x-[115%]')).toBe(true);

    // Toggle without argument (inverts current state)
    ui.toggleChatDrawer();
    expect(ui.isChatDrawerOpen()).toBe(true);
    ui.toggleChatDrawer();
    expect(ui.isChatDrawerOpen()).toBe(false);
  });

  it('updates chat session details in the drawer header', () => {
    ui.setChatSessionDetails('SANCT-9999', 'Bishop White', 'white');

    expect(domElements['chat-session-code-badge']!.textContent).toBe('SANCT-9999');
    expect(domElements['chat-current-player-name']!.textContent).toBe('Bishop White');
    expect(domElements['chat-current-player-role']!.textContent).toBe('WHITE');
  });

  it('manages chat input value, focus, and character counter', () => {
    expect(ui.getChatInputValue()).toBe('');

    ui.setChatInputValue('Sanctuary blessing');
    expect(ui.getChatInputValue()).toBe('Sanctuary blessing');
    expect(domElements['chat-char-counter']!.textContent).toBe('18/500');

    ui.focusChatInput();
    expect(domElements['chat-input']!.focused).toBe(true);

    ui.updateChatCharCounter(17, 300);
    expect(domElements['chat-char-counter']!.textContent).toBe('17/300');
  });

  it('updates unread badge visibility and count', () => {
    ui.updateChatUnreadBadge(0);
    expect(domElements['chat-unread-badge']!.classList.contains('hidden')).toBe(true);

    ui.updateChatUnreadBadge(5);
    expect(domElements['chat-unread-badge']!.classList.contains('hidden')).toBe(false);
    expect(domElements['chat-unread-badge']!.textContent).toBe('5');

    // Caps display at 99+
    ui.updateChatUnreadBadge(150);
    expect(domElements['chat-unread-badge']!.textContent).toBe('99+');
  });

  it('mirrors unread state onto per-arcade-theater chat badges', () => {
    const arcadeBadge = new MockElement();
    (globalThis.document as any).querySelectorAll = (selector: string) =>
      selector === '.arcade-chat-unread-badge' ? [arcadeBadge] : [];

    ui.updateChatUnreadBadge(3);
    expect(arcadeBadge.classList.contains('hidden')).toBe(false);
    expect(arcadeBadge.textContent).toBe('3');

    ui.updateChatUnreadBadge(0);
    expect(arcadeBadge.classList.contains('hidden')).toBe(true);
    expect(arcadeBadge.textContent).toBe('0');
  });

  it('appends messages for all roles (white, black, spectator, host, other), hiding empty state', () => {
    const ownMsg = {
      id: 'msg-own',
      senderName: 'Architect',
      senderRole: 'white',
      message: 'Move e4 initiated',
      createdAt: 1700000000000
    };

    ui.appendChatMessage(ownMsg, true);
    expect(domElements['chat-empty-notice']!.classList.contains('hidden')).toBe(true);
    expect(domElements['chat-messages-container']!.children.length).toBe(1);

    const blackMsg = {
      id: 'msg-black',
      senderName: 'Black Player',
      senderRole: 'black',
      message: 'Move e5 responded',
      createdAt: 1700000010000
    };
    ui.appendChatMessage(blackMsg, false);
    expect(domElements['chat-messages-container']!.children.length).toBe(2);

    const spectatorMsg = {
      id: 'msg-spec',
      senderName: 'Spectator Observer',
      senderRole: 'spectator',
      message: 'Exciting match!',
      createdAt: 1700000020000
    };
    ui.appendChatMessage(spectatorMsg, false);
    expect(domElements['chat-messages-container']!.children.length).toBe(3);

    const hostMsg = {
      id: 'msg-host',
      senderName: 'Room Host',
      senderRole: 'host',
      message: 'Welcome everyone',
      createdAt: 1700000030000
    };
    ui.appendChatMessage(hostMsg, false);
    expect(domElements['chat-messages-container']!.children.length).toBe(4);

    const otherMsg = {
      id: 'msg-other',
      senderName: 'Player 3',
      senderRole: 'seat_3',
      message: 'Ready to play',
      createdAt: 1700000040000
    };
    ui.appendChatMessage(otherMsg, false);
    expect(domElements['chat-messages-container']!.children.length).toBe(5);

    // Clear messages resets container and restores empty state
    ui.clearChatMessages();
    expect(domElements['chat-messages-container']!.innerHTML).toContain('chat-empty-notice');
    expect(domElements['chat-messages-container']!.innerHTML).toContain('No messages yet');
  });

  it('renders a message containing a bare URL as a clickable link, stripping trailing sentence punctuation', () => {
    const urlMsg = {
      id: 'msg-url',
      senderName: 'Architect',
      senderRole: 'white',
      message: 'Check this out: https://example.com/game-rules.',
      createdAt: 1700000050000
    };
    ui.appendChatMessage(urlMsg, false);
    const bubble = domElements['chat-messages-container']!.children.at(-1)!;
    expect(bubble.innerHTML).toContain('<a href="https://example.com/game-rules" target="_blank" rel="noopener noreferrer"');
    expect(bubble.innerHTML).toContain('>https://example.com/game-rules</a>.');
    expect(bubble.innerHTML).toContain('Check this out: ');
  });

  it('renders markdown-style [label](url) links with the label as the visible text', () => {
    const mdMsg = {
      id: 'msg-md',
      senderName: 'Architect',
      senderRole: 'white',
      message: 'Read the [rules](https://example.com/rules) before you move.',
      createdAt: 1700000060000
    };
    ui.appendChatMessage(mdMsg, false);
    const bubble = domElements['chat-messages-container']!.children.at(-1)!;
    expect(bubble.innerHTML).toContain('<a href="https://example.com/rules" target="_blank" rel="noopener noreferrer"');
    expect(bubble.innerHTML).toContain('>rules</a>');
    expect(bubble.innerHTML).not.toContain('>https://example.com/rules</a>');
  });

  it('never turns a non-http(s) scheme into a clickable link and still escapes it as plain text', () => {
    const unsafeMsg = {
      id: 'msg-unsafe',
      senderName: 'Architect',
      senderRole: 'white',
      message: 'Try javascript:alert(1) or <script>alert(2)</script>',
      createdAt: 1700000070000
    };
    ui.appendChatMessage(unsafeMsg, false);
    const bubble = domElements['chat-messages-container']!.children.at(-1)!;
    expect(bubble.innerHTML).not.toContain('<a href');
    expect(bubble.innerHTML).toContain('&lt;script&gt;');
    expect(bubble.innerHTML).not.toContain('<script>');
  });

  it('renders an emoji-only message jumbo-sized, like a sticker', () => {
    const emojiMsg = {
      id: 'msg-emoji',
      senderName: 'Architect',
      senderRole: 'white',
      message: '🎉🦆🔥',
      createdAt: 1700000080000
    };
    ui.appendChatMessage(emojiMsg, false);
    const bubble = domElements['chat-messages-container']!.children.at(-1)!;
    expect(bubble.innerHTML).toContain('text-3xl');
    expect(bubble.innerHTML).not.toContain('leading-relaxed');
  });

  it('renders a mixed text+emoji message with normal sizing, not jumbo', () => {
    const mixedMsg = {
      id: 'msg-mixed',
      senderName: 'Architect',
      senderRole: 'white',
      message: 'nice move 🎉',
      createdAt: 1700000090000
    };
    ui.appendChatMessage(mixedMsg, false);
    const bubble = domElements['chat-messages-container']!.children.at(-1)!;
    expect(bubble.innerHTML).toContain('leading-relaxed');
    expect(bubble.innerHTML).not.toContain('text-3xl');
  });

  it('handles scrollChatToBottom safely', () => {
    domElements['chat-messages-container']!.scrollHeight = 500;
    ui.scrollChatToBottom();
    expect(domElements['chat-messages-container']!.scrollTop).toBe(500);
  });
});

describe('renderChatMessageMarkup', () => {
  it('escapes plain text with no links completely unchanged aside from HTML metacharacters', () => {
    expect(renderChatMessageMarkup('Good game, well played!')).toBe('Good game, well played!');
    expect(renderChatMessageMarkup('a < b && b > c')).toBe('a &lt; b &amp;&amp; b &gt; c');
  });

  it('handles an empty string without throwing', () => {
    expect(renderChatMessageMarkup('')).toBe('');
  });

  it('renders multiple links in the same message, each independently', () => {
    const result = renderChatMessageMarkup('See https://a.example.com and [b](https://b.example.com) too');
    expect(result).toContain('<a href="https://a.example.com"');
    expect(result).toContain('>https://a.example.com</a>');
    expect(result).toContain('<a href="https://b.example.com"');
    expect(result).toContain('>b</a>');
    expect(result).toContain(' and ');
    expect(result).toContain(' too');
  });

  it('escapes HTML metacharacters inside a markdown link label', () => {
    const result = renderChatMessageMarkup('[<b>bold</b>](https://example.com)');
    expect(result).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(result).not.toContain('<b>bold</b>');
  });

  it('leaves a bare URL with no trailing punctuation fully intact', () => {
    expect(renderChatMessageMarkup('https://example.com/path?q=1')).toBe(
      '<a href="https://example.com/path?q=1" target="_blank" rel="noopener noreferrer" class="text-sky-300 underline break-all hover:text-sky-200">https://example.com/path?q=1</a>'
    );
  });
});

describe('isEmojiOnlyMessage', () => {
  it('is true for emoji, with or without surrounding whitespace', () => {
    expect(isEmojiOnlyMessage('🎉')).toBe(true);
    expect(isEmojiOnlyMessage('  🎉🦆🔥  ')).toBe(true);
    expect(isEmojiOnlyMessage('🇺🇸')).toBe(true);
  });

  it('is false for plain text, mixed text+emoji, digits, and empty strings', () => {
    expect(isEmojiOnlyMessage('nice move')).toBe(false);
    expect(isEmojiOnlyMessage('nice move 🎉')).toBe(false);
    expect(isEmojiOnlyMessage('12345')).toBe(false);
    expect(isEmojiOnlyMessage('')).toBe(false);
    expect(isEmojiOnlyMessage('   ')).toBe(false);
  });

  it('is false once the emoji count exceeds the jumbo cap', () => {
    expect(isEmojiOnlyMessage('🎉'.repeat(12))).toBe(true);
    expect(isEmojiOnlyMessage('🎉'.repeat(13))).toBe(false);
  });
});
