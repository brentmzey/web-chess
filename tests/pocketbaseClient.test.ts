import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { PocketBaseChessClient, POCKETHOST_URL } from '../src/realtime/pocketbaseClient';

describe('PocketBaseChessClient Realtime Adapter & PocketHost Connectivity', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEventSource: typeof globalThis.EventSource;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEventSource = globalThis.EventSource;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  });

  it('initializes with default PocketHost URL and tracks connection and sequence', () => {
    const client = new PocketBaseChessClient({
      sessionId: 'sess-123',
      participantId: 'part-456',
      token: 'tok-789'
    });

    expect(client.getBaseUrl()).toBe(POCKETHOST_URL);
    expect(client.getIsConnected()).toBe(false);
    expect(client.getClientId()).toBe(null);
    expect(client.getLastEventSeq()).toBe(0);
  });

  it('manages typed event listeners and unsubscriptions', () => {
    const client = new PocketBaseChessClient({
      sessionId: 'sess-123',
      participantId: 'part-456',
      token: 'tok-789'
    });

    let received = 0;
    const unsub = client.on('test_event', () => {
      received++;
    });

    (client as any).dispatchEvent('test_event', { data: 1 }, 1);
    expect(received).toBe(1);

    unsub();
    (client as any).dispatchEvent('test_event', { data: 2 }, 2);
    expect(received).toBe(1);
  });

  it('gracefully catches errors inside event listeners', () => {
    const client = new PocketBaseChessClient({
      sessionId: 'sess-123',
      participantId: 'part-456',
      token: 'tok-789'
    });

    client.on('err_event', () => {
      throw new Error('Listener failed');
    });

    expect(() => {
      (client as any).dispatchEvent('err_event', {}, 1);
    }).not.toThrow();
  });

  it('connects via EventSource, handles PB_CONNECT, and routes session_events and game_sessions', async () => {
    let opened = false;
    let moveReceived: any = null;
    let sessionUpdated = false;

    const listeners: Record<string, Function> = {};
    class MockEventSource {
      public onerror: Function | null = null;
      constructor(public url: string) {}
      addEventListener(event: string, handler: Function) {
        listeners[event] = handler;
      }
      close() {}
    }

    (globalThis as any).EventSource = MockEventSource;

    // Mock fetch for PB subscription
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({}), { status: 204 });
    }) as any;

    const client = new PocketBaseChessClient({
      sessionId: 'sess-123',
      participantId: 'part-456',
      token: 'tok-789',
      onOpen: () => { opened = true; },
      onMove: (data) => { moveReceived = data; }
    });

    client.on('session_updated', () => {
      sessionUpdated = true;
    });

    await client.connect();
    expect(client.getBaseUrl()).toBe(POCKETHOST_URL);

    // Trigger PB_CONNECT
    await listeners['PB_CONNECT']({
      data: JSON.stringify({ clientId: 'client-abc' })
    });
    expect(client.getIsConnected()).toBe(true);
    expect(opened).toBe(true);

    // Trigger session_events for this session
    listeners['session_events']({
      data: JSON.stringify({
        action: 'create',
        record: {
          session: 'sess-123',
          event_type: 'move_made',
          event_seq: 4,
          payload: { san: 'e4', ply: 1 }
        }
      })
    });
    expect(moveReceived).toEqual({ san: 'e4', ply: 1 });
    expect(client.getLastEventSeq()).toBe(4);

    // Trigger session_events for other session (should be ignored)
    listeners['session_events']({
      data: JSON.stringify({
        action: 'create',
        record: {
          session: 'other-session',
          event_type: 'move_made',
          payload: { san: 'd4' }
        }
      })
    });

    // Trigger game_sessions update
    listeners['game_sessions']({
      data: JSON.stringify({
        record: { id: 'sess-123', status: 'in_progress' }
      })
    });
    expect(sessionUpdated).toBe(true);

    // Trigger error
    let errorCalled = false;
    (client as any).config.onError = () => { errorCalled = true; };
    (client as any).eventSource.onerror(new Error('SSE disconnected'));
    expect(client.getIsConnected()).toBe(false);
    expect(errorCalled).toBe(true);

    client.disconnect();
    expect(client.getIsConnected()).toBe(false);
  });

  it('dispatches moves, theme changes, and resignations via REST', async () => {
    const fetchCalls: Array<{ url: string; method: string; body: any }> = [];

    globalThis.fetch = mock(async (url: any, init?: any) => {
      fetchCalls.push({
        url: String(url),
        method: init?.method || 'GET',
        body: init?.body ? JSON.parse(init.body) : null
      });
      return new Response(JSON.stringify({ id: 'rec-123' }), { status: 200 });
    }) as any;

    const client = new PocketBaseChessClient({
      sessionId: 'sess-123',
      participantId: 'part-456',
      token: 'tok-789'
    });

    const moveRes = await client.makeMove({
      ply: 1,
      color: 'w',
      from: 'e2',
      to: 'e4',
      san: 'e4',
      fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      isCheck: false,
      isCheckmate: false
    });

    expect(moveRes.isSuccess()).toBe(true);
    expect(fetchCalls.length).toBe(3); // moves, events, game_sessions patch

    const submitRes = await client.submitMove('e5', {
      ply: 2,
      color: 'b',
      from: 'e7',
      to: 'e5',
      fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      capturedPiece: null,
      isCheck: false,
      isCheckmate: false,
      timeSpentMs: 500
    });
    expect(submitRes.isSuccess()).toBe(true);

    const themeRes = await client.changeTheme('emerald-citadel');
    expect(themeRes.isSuccess()).toBe(true);

    const resignRes = await client.resign();
    expect(resignRes.isSuccess()).toBe(true);
  });

  it('creates sessions via PocketBaseChessClient.createSession with role branching', async () => {
    globalThis.fetch = mock(async (url: any, _init?: any) => {
      const u = String(url);
      if (u.includes('game_sessions/records')) {
        return new Response(JSON.stringify({ id: 'sess-abc' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'part-def' }), { status: 200 });
    }) as any;

    const resWhite = await PocketBaseChessClient.createSession('', {
      mode: 'live',
      theme: 'gothic-basilica',
      timerRule: 'none',
      strictMode: false,
      role: 'w'
    });

    expect(resWhite.isSuccess()).toBe(true);
    resWhite.match({
      Ok: (s) => {
        expect(s.sessionId).toBe('sess-abc');
        expect(s.sessionCode.startsWith('SANCT-')).toBe(true);
        expect(s.assignedRole).toBe('w');
      },
      Err: (err) => { throw err; }
    });

    const resBlack = await PocketBaseChessClient.createSession('', {
      mode: 'live',
      theme: 'gothic-basilica',
      timerRule: 'none',
      strictMode: false,
      role: 'b'
    });
    expect(resBlack.match({ Ok: (s) => s.assignedRole, Err: () => null })).toBe('b');

    const resRand = await PocketBaseChessClient.createSession('', {
      mode: 'live',
      theme: 'gothic-basilica',
      timerRule: 'none',
      strictMode: false,
      role: 'rand'
    });
    expect(['w', 'b']).toContain(resRand.match({ Ok: (s) => s.assignedRole, Err: () => null }) as any);
  });

  it('joins existing sessions and resolves roles properly', async () => {
    globalThis.fetch = mock(async (url: any, _init?: any) => {
      const u = String(url);
      if (u.includes('filter=')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'sess-abc',
            white_player_name: 'Host',
            black_player_name: '',
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            theme: 'gothic-basilica'
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'part-challenger' }), { status: 200 });
    }) as any;

    const joinRes = await PocketBaseChessClient.joinSession('', {
      sessionCode: 'SANCT-TEST',
      displayName: 'Black Challenger',
      preferredRole: 'b'
    });

    expect(joinRes.isSuccess()).toBe(true);
    joinRes.match({
      Ok: (j) => {
        expect(j.sessionId).toBe('sess-abc');
        expect(j.assignedRole).toBe('black');
      },
      Err: (err) => { throw err; }
    });
  });

  it('handles session lookup failures when joining', async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as any;

    const joinRes = await PocketBaseChessClient.joinSession('', {
      sessionCode: 'SANCT-NONE'
    });

    expect(joinRes.isFailure()).toBe(true);
  });

  it('covers PB_CONNECT error paths, failed subscriptions, and malformed SSE payloads', async () => {
    const listeners: Record<string, Function> = {};
    class MockEventSource {
      public onerror: Function | null = null;
      constructor(public url: string) {}
      addEventListener(event: string, handler: Function) {
        listeners[event] = handler;
      }
      close() {}
    }
    (globalThis as any).EventSource = MockEventSource;

    // Return non-ok status for subscription
    globalThis.fetch = mock(async () => {
      return new Response('Subscription failed', { status: 400 });
    }) as any;

    const client = new PocketBaseChessClient({
      sessionId: 'sess-123',
      participantId: 'part-456',
      token: 'tok-789'
    });

    await client.connect();

    // Trigger PB_CONNECT with valid JSON but fetch fails with status 400
    await listeners['PB_CONNECT']({
      data: JSON.stringify({ clientId: 'client-sub-fail' })
    });

    // Trigger PB_CONNECT with invalid JSON
    await listeners['PB_CONNECT']({
      data: 'invalid-json'
    });

    // Trigger session_events with invalid JSON
    listeners['session_events']({
      data: 'not-json'
    });

    // Trigger game_sessions with invalid JSON
    listeners['game_sessions']({
      data: 'not-json'
    });

    expect(client.getIsConnected()).toBe(true);
  });

  it('covers createSession failure when POST returns non-200', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('Internal error', { status: 500, statusText: 'Internal Error' });
    }) as any;

    const res = await PocketBaseChessClient.createSession('', {
      mode: 'live',
      theme: 'gothic-basilica',
      timerRule: 'none',
      strictMode: false,
      role: 'w'
    });

    expect(res.isFailure()).toBe(true);
  });

  it('covers joinSession query network failure and role resolution permutations', async () => {
    // 1. Query network failure
    globalThis.fetch = mock(async () => {
      return new Response('Network error', { status: 500, statusText: 'Query Failed' });
    }) as any;

    const failRes = await PocketBaseChessClient.joinSession('', {
      sessionCode: 'SANCT-FAIL'
    });
    expect(failRes.isFailure()).toBe(true);

    // 2. Joining with preferredRole 'w' and white is open
    globalThis.fetch = mock(async (url: any, _init?: any) => {
      const u = String(url);
      if (u.includes('filter=')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'sess-white-open',
            white_player_name: '',
            black_player_name: 'ExistingBlack',
            fen: 'start-fen',
            theme: 'emerald-citadel'
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'part-res' }), { status: 200 });
    }) as any;

    const whiteJoin = await PocketBaseChessClient.joinSession('', {
      sessionCode: 'SANCT-W',
      preferredRole: 'w'
    });
    expect(whiteJoin.isSuccess()).toBe(true);
    expect(whiteJoin.match({ Ok: (j) => j.assignedRole, Err: () => null })).toBe('white');

    // 3. Joining with preferredRole 'b' and fallback when neither preferred nor spectator specified
    globalThis.fetch = mock(async (url: any, _init?: any) => {
      const u = String(url);
      if (u.includes('filter=')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'sess-black-open',
            white_player_name: 'ExistingWhite',
            black_player_name: '',
            fen: 'start-fen',
            theme: 'astral-observatory'
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'part-res' }), { status: 200 });
    }) as any;

    const noPrefJoin = await PocketBaseChessClient.joinSession('', {
      sessionCode: 'SANCT-AUTO'
    });
    expect(noPrefJoin.isSuccess()).toBe(true);
    expect(noPrefJoin.match({ Ok: (j) => j.assignedRole, Err: () => null })).toBe('black');
  });
});
