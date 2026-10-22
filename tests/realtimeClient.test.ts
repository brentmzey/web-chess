import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { RealtimeChessClient } from '../src/realtime/realtimeClient';

class MockEventSource {
  public url: string;
  public onopen: (() => void) | null = null;
  public onerror: ((e: any) => void) | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  public isClosed: boolean = false;

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => this.onopen?.());
  }

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter(l => l !== listener);
  }

  close() {
    this.isClosed = true;
  }

  simulateEvent(type: string, data: any, lastEventId: string = '1') {
    const list = this.listeners[type] || [];
    list.forEach(l => l({ data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId }));
  }
}

describe('RealtimeChessClient Browser SSE Subscriber & REST Mutations', () => {
  const originalEventSource = (globalThis as any).EventSource;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
    globalThis.fetch = originalFetch;
  });

  it('connects to SSE endpoint, tracks connection state, and dispatches typed events', async () => {
    let opened = false;
    let receivedMove: any = null;
    let receivedTheme: string = '';

    const client = new RealtimeChessClient({
      baseUrl: 'http://localhost:3000',
      sessionId: 'sess-abc',
      participantId: 'p-1',
      token: 'tok-123',
      onOpen: () => {
        opened = true;
      },
      onMove: data => {
        receivedMove = data;
      },
      onThemeChanged: data => {
        receivedTheme = data.theme;
      }
    });

    expect(client.getBaseUrl()).toBe('http://localhost:3000');
    expect(client.getIsConnected()).toBe(false);

    client.connect();

    // Allow microtask onopen
    await new Promise(r => setTimeout(r, 10));
    expect(opened).toBe(true);
    expect(client.getIsConnected()).toBe(true);

    const es = (client as any).eventSource as MockEventSource;
    expect(es).toBeDefined();
    expect(es.url).toContain('/api/sessions/sess-abc/events?participantId=p-1&token=tok-123');

    // Simulate move_made event
    es.simulateEvent('move_made', { san: 'e4', ply: 1 }, '1');
    expect(receivedMove).toEqual({ san: 'e4', ply: 1 });
    expect(client.getLastEventSeq()).toBe(1);

    // Simulate theme_changed event
    es.simulateEvent('theme_changed', { theme: 'emerald-citadel' }, '2');
    expect(receivedTheme).toBe('emerald-citadel');
    expect(client.getLastEventSeq()).toBe(2);

    client.disconnect();
    expect(client.getIsConnected()).toBe(false);
    expect(es.isClosed).toBe(true);
  });

  it('handles custom event subscriptions and unsubscriptions via client.on', () => {
    const client = new RealtimeChessClient({
      sessionId: 's',
      participantId: 'p',
      token: 't'
    });

    let calls = 0;
    const unsub = client.on('custom_event', () => {
      calls++;
    });

    client.connect();
    const es = (client as any).eventSource as MockEventSource;
    es.simulateEvent('custom_event', { msg: 'hello' }, '1');
    expect(calls).toBe(1);

    unsub();
    es.simulateEvent('custom_event', { msg: 'again' }, '2');
    expect(calls).toBe(1);

    client.disconnect();
  });

  it('handles connection error and missing EventSource gracefully', () => {
    let errorCaught = false;
    const client = new RealtimeChessClient({
      sessionId: 's',
      participantId: 'p',
      token: 't',
      onError: () => {
        errorCaught = true;
      }
    });

    client.connect();
    const es = (client as any).eventSource as MockEventSource;
    es.onerror?.(new Error('Simulated network drop'));
    expect(errorCaught).toBe(true);
    expect(client.getIsConnected()).toBe(false);

    client.disconnect();

    // Environment without EventSource
    (globalThis as any).EventSource = undefined;
    const headlessClient = new RealtimeChessClient({ sessionId: 's', participantId: 'p', token: 't' });
    headlessClient.connect();
    expect(headlessClient.getIsConnected()).toBe(false);
  });

  it('submits moves, resignations, and theme changes via REST helpers', async () => {
    globalThis.fetch = (async (url: string, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/moves')) {
        return new Response(JSON.stringify({ move: { san: 'e4' } }), { status: 200 });
      }
      if (u.includes('/resign')) {
        return new Response(JSON.stringify({ session: { status: 'resigned' } }), { status: 200 });
      }
      if (u.includes('/theme')) {
        return new Response(JSON.stringify({ session: { theme: 'emerald-citadel' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }) as any;

    const client = new RealtimeChessClient({
      baseUrl: 'http://localhost:3000',
      sessionId: 'sess-1',
      participantId: 'p-1',
      token: 'tok'
    });

    const moveRes = await client.submitMove('e4');
    expect(moveRes.isSuccess()).toBe(true);

    const resignRes = await client.resign();
    expect(resignRes.isSuccess()).toBe(true);

    const themeRes = await client.changeTheme('emerald-citadel');
    expect(themeRes.isSuccess()).toBe(true);
  });

  it('provides static factory methods for creating, joining, and fetching sessions', async () => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method || 'GET';
      if (u.endsWith('/api/sessions') && method === 'POST') {
        return new Response(JSON.stringify({ session: { id: 's1' }, token: 't1' }), { status: 201 });
      }
      if (u.endsWith('/api/sessions/join') && method === 'POST') {
        return new Response(JSON.stringify({ session: { id: 's1' }, token: 't2' }), { status: 200 });
      }
      if (u.includes('/api/sessions/s1') && method === 'GET') {
        return new Response(JSON.stringify({ session: { id: 's1' }, moves: [], participants: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Failed' }), { status: 400 });
    }) as any;

    const createRes = await RealtimeChessClient.createSession({ creatorDisplayName: 'Tester' }, 'http://localhost:3000');
    expect(createRes.isSuccess()).toBe(true);
    expect((createRes.getOrThrow() as any).session.id).toBe('s1');

    const joinRes = await RealtimeChessClient.joinSession({ sessionCode: 'SANCT-XYZ', displayName: 'Joiner' }, 'http://localhost:3000');
    expect(joinRes.isSuccess()).toBe(true);

    const fetchRes = await RealtimeChessClient.fetchSession('s1', 'http://localhost:3000');
    expect(fetchRes.isSuccess()).toBe(true);

    // Error handling branches for client REST requests
    const errClient = new RealtimeChessClient({ sessionId: 's1', participantId: 'p1', token: 'tok' });
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Server Failure' }), { status: 500 })) as any;
    expect((await errClient.submitMove('e4')).isFailure()).toBe(true);
    expect((await errClient.resign()).isFailure()).toBe(true);
    expect((await errClient.changeTheme('theme')).isFailure()).toBe(true);
    expect((await RealtimeChessClient.createSession({}, 'http://localhost:3000')).isFailure()).toBe(true);
    expect((await RealtimeChessClient.joinSession({ sessionCode: 'c', displayName: 'd' }, 'http://localhost:3000')).isFailure()).toBe(true);
    expect((await RealtimeChessClient.fetchSession('s1', 'http://localhost:3000')).isFailure()).toBe(true);
  });

  it('converts error types accurately with toErrorString', () => {
    const { toErrorString } = require('../src/realtime/realtimeClient');
    expect(toErrorString(new Error('Sample error'))).toBe('Sample error');
    expect(toErrorString('Plain string error')).toBe('Plain string error');
  });
});
