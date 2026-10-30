import { describe, expect, it, mock } from 'bun:test';
import { ArcadeRealtimeClient } from '../src/realtime/arcadeRealtimeClient';

describe('ArcadeRealtimeClient - Universal Client-Side Real-Time Adapter', () => {
  it('manages event handlers and unsubscription', () => {
    const client = new ArcadeRealtimeClient({
      sessionCode: 'BJK-TEST',
      participantId: 'p_test_1'
    });

    let eventCalled = 0;
    const unsub = client.on('seat_claimed', () => {
      eventCalled += 1;
    });

    expect(client.getBaseUrl()).toBe('');
    expect(client.getIsConnected()).toBe(false);
    expect(client.getLastEventSeq()).toBe(0);

    unsub();
  });

  it('claims a seat via HTTP endpoint', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ seatNumber: 3, sessionCode: 'POKER-TEST' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const client = new ArcadeRealtimeClient({
        sessionCode: 'POKER-TEST',
        participantId: 'usr_p3'
      });

      const res = await client.claimSeat('Ace Player');
      expect(res.isSuccess()).toBe(true);
      expect(res.getOrThrow().seatNumber).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('leaves a seat and restores bot', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ message: 'Participant vacated' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const client = new ArcadeRealtimeClient({
        sessionCode: 'SKIP-TEST',
        participantId: 'usr_p2'
      });

      const res = await client.leaveSeat();
      expect(res.isSuccess()).toBe(true);
      expect(res.getOrThrow().message).toBe('Participant vacated');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sends real-time actions across players', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ event: { id: 1, actionType: 'play_card' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const client = new ArcadeRealtimeClient({
        sessionCode: 'P10-TEST',
        participantId: 'usr_p1'
      });

      const res = await client.sendAction('play_card', { cardId: 'c1' });
      expect(res.isSuccess()).toBe(true);

      const dispatchRes = await client.dispatchAction('play_card', { cardId: 'c1' });
      expect(dispatchRes.isSuccess()).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTTP error responses gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: 'Server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const client = new ArcadeRealtimeClient({
        sessionCode: 'ERR-TEST',
        participantId: 'usr_p1'
      });

      const claimRes = await client.claimSeat('Bob');
      expect(claimRes.isFailure()).toBe(true);

      const leaveRes = await client.leaveSeat();
      expect(leaveRes.isFailure()).toBe(true);

      const actRes = await client.sendAction('bet', {});
      expect(actRes.isFailure()).toBe(true);

      const kickRes = await client.kickPlayer('bad_p1', 'Spamming');
      expect(kickRes.isFailure()).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('kicks a player when invoked by match host', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ success: true, kickedParticipantId: 'bad_usr', seatNumber: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const client = new ArcadeRealtimeClient({
        sessionCode: 'POKER-HOST',
        participantId: 'host_usr'
      });

      const res = await client.kickPlayer('bad_usr', 'Inappropriate behavior');
      expect(res.isSuccess()).toBe(true);
      expect(res.getOrThrow().kickedParticipantId).toBe('bad_usr');
      expect(res.getOrThrow().seatNumber).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('connects to EventSource, listens to messages, and disconnects', () => {
    class MockEventSource {
      public listeners: Record<string, ((e: any) => void)[]> = {};
      public onopen: (() => void) | null = null;
      public onerror: ((err: any) => void) | null = null;
      constructor(public url: string) {}
      public addEventListener(evt: string, fn: (e: any) => void) {
        this.listeners[evt] = this.listeners[evt] || [];
        this.listeners[evt]!.push(fn);
      }
      public close() {}
    }

    const originalES = (globalThis as any).EventSource;
    (globalThis as any).EventSource = MockEventSource;

    try {
      let opened = false;
      let errorOccurred = false;
      let receivedData: any = null;

      const client = new ArcadeRealtimeClient({
        sessionCode: 'BJK-EVT',
        participantId: 'p1',
        onOpen: () => { opened = true; },
        onError: () => { errorOccurred = true; }
      });

      client.on('game_action', (data) => {
        receivedData = data;
      });

      client.connect();
      expect(client.getIsConnected()).toBe(false);

      const es = (client as any).eventSource as MockEventSource;
      expect(es).toBeDefined();

      // Trigger onopen
      es.onopen?.();
      expect(client.getIsConnected()).toBe(true);
      expect(opened).toBe(true);

      // Trigger incoming event
      const handler = es.listeners['game_action']?.[0];
      expect(handler).toBeDefined();
      handler?.({ lastEventId: '5', data: JSON.stringify({ action: 'hit' }) });

      expect(receivedData).toEqual({ action: 'hit' });
      expect(client.getLastEventSeq()).toBe(5);

      // Register listener after connected
      let postConnectData: any = null;
      client.on('seat_claimed', (d) => {
        postConnectData = d;
      });
      const seatHandler = es.listeners['seat_claimed']?.[0];
      expect(seatHandler).toBeDefined();

      // Non-JSON plain text data
      seatHandler?.({ lastEventId: '6', data: 'plain text data' });
      expect(postConnectData).toBe('plain text data');

      // Throwing listener does not crash client
      client.on('seat_claimed', () => {
        throw new Error('Exploding event handler');
      });
      seatHandler?.({ lastEventId: '7', data: JSON.stringify({ ok: true }) });

      // Calling connect while already connected reconnects
      client.connect();

      // Trigger error
      es.onerror?.({ message: 'connection dropped' });
      expect(client.getIsConnected()).toBe(false);
      expect(errorOccurred).toBe(true);

      // Disconnect
      client.disconnect();
      expect((client as any).eventSource).toBeNull();

      // Constructor throwing is caught safely
      (globalThis as any).EventSource = class BrokenEventSource {
        constructor() {
          throw new Error('Network permission denied');
        }
      };
      let brokenErrorHandled = false;
      const brokenClient = new ArcadeRealtimeClient({
        sessionCode: 'BJK-ERR',
        participantId: 'p_err',
        onError: () => { brokenErrorHandled = true; }
      });
      brokenClient.connect();
      expect(brokenErrorHandled).toBe(true);
    } finally {
      (globalThis as any).EventSource = originalES;
    }
  });

  it('operates in PocketBase mode on remote environments and handles SSE pub/sub', async () => {
    const originalWindow = (globalThis as any).window;
    const originalFetch = globalThis.fetch;
    const originalES = (globalThis as any).EventSource;

    const postedEvents: any[] = [];
    globalThis.fetch = mock(async (url: string, init?: any) => {
      if (url.includes('/records')) {
        const body = JSON.parse(init?.body || '{}');
        postedEvents.push(body);
        return new Response(JSON.stringify({ id: 'rec_123', ...body }), { status: 200 });
      }
      if (url.includes('/api/realtime')) {
        return new Response(JSON.stringify({ status: 'subscribed' }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as any;

    let mockESInstance: any = null;
    (globalThis as any).EventSource = class MockPocketBaseEventSource {
      public listeners: Record<string, ((e: any) => void)[]> = {};
      public onerror: ((err: any) => void) | null = null;
      constructor(public url: string) {
        mockESInstance = this;
      }
      public addEventListener(type: string, cb: (e: any) => void) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(cb);
      }
      public close() {}
    };

    (globalThis as any).window = {
      location: { hostname: 'web-chess-app.netlify.app' }
    };

    try {
      const client = new ArcadeRealtimeClient({
        sessionCode: 'BJK-PBRUN',
        participantId: 'usr_pb1'
      });

      expect(client.getBaseUrl()).toBe('https://web-chess.pockethost.io');
      expect(client.isPocketBaseMode()).toBe(true);

      // Connect to PocketBase SSE
      let opened = false;
      let errorFired = false;
      (client as any).config.onOpen = () => { opened = true; };
      (client as any).config.onError = () => { errorFired = true; };
      client.connect();

      expect(mockESInstance).not.toBeNull();
      expect(mockESInstance.url).toBe('https://web-chess.pockethost.io/api/realtime');

      // Simulate PB_CONNECT greeting
      const pbConnectCb = mockESInstance.listeners['PB_CONNECT']?.[0];
      expect(pbConnectCb).toBeDefined();
      await pbConnectCb({ data: JSON.stringify({ clientId: 'cid_pb999' }) });
      expect(client.getClientId()).toBe('cid_pb999');
      expect(client.getIsConnected()).toBe(true);
      expect(opened).toBe(true);

      // Claim seat in PocketBase mode
      const claimRes = await client.claimSeat('Pilgrim PB');
      expect(claimRes.isSuccess()).toBe(true);
      expect(claimRes.getOrThrow().sessionCode).toBe('BJK-PBRUN');

      // Send action in PocketBase mode
      const actRes = await client.sendAction('bjk_deal', { deckCount: 6 });
      expect(actRes.isSuccess()).toBe(true);

      // Kick player in PocketBase mode
      const kickRes = await client.kickPlayer('bad_player_1', 'Disruptive');
      expect(kickRes.isSuccess()).toBe(true);

      // Leave seat in PocketBase mode
      const leaveRes = await client.leaveSeat();
      expect(leaveRes.isSuccess()).toBe(true);

      // Verify records sent to PocketBase session_events
      expect(postedEvents.length).toBeGreaterThanOrEqual(4);
      expect(postedEvents.some(p => p.event_type === 'seat_claimed')).toBe(true);
      expect(postedEvents.some(p => p.event_type === 'action_dispatched')).toBe(true);
      expect(postedEvents.some(p => p.event_type === 'player_kicked')).toBe(true);
      expect(postedEvents.some(p => p.event_type === 'seat_left')).toBe(true);

      // Simulate receiving a broadcasted session event
      let dispatchedAction: any = null;
      client.on('action_dispatched', data => {
        dispatchedAction = data;
      });

      const sseHandler = mockESInstance.listeners['session_events']?.[0];
      expect(sseHandler).toBeDefined();
      sseHandler({
        data: JSON.stringify({
          record: {
            session: 'BJK-PBRUN',
            event_type: 'action_dispatched',
            event_seq: 10,
            payload: { actionType: 'bjk_deal', payload: { ok: true } }
          }
        })
      });
      expect(dispatchedAction).toEqual({ actionType: 'bjk_deal', payload: { ok: true } });
      expect(client.getLastEventSeq()).toBe(10);

      // Test error callback
      mockESInstance.onerror({ message: 'network down' });
      expect(client.getIsConnected()).toBe(false);
      expect(errorFired).toBe(true);

      // Disconnect
      client.disconnect();
      expect(client.getIsConnected()).toBe(false);

      // Explicit baseUrl overrides environment
      const customClient = new ArcadeRealtimeClient({
        baseUrl: 'https://custom.pockethost.io',
        sessionCode: 'BJK-PBRUN',
        participantId: 'usr_custom'
      });
      expect(customClient.getBaseUrl()).toBe('https://custom.pockethost.io');
      expect(customClient.getParticipantId()).toBe('usr_custom');

      // Localhost hostname returns empty string
      (globalThis as any).window.location.hostname = 'localhost';
      const localClient = new ArcadeRealtimeClient({
        sessionCode: 'BJK-PBRUN',
        participantId: 'usr_local'
      });
      expect(localClient.getBaseUrl()).toBe('');

      // Test PB_CONNECT parse warning catch
      (globalThis as any).window.location.hostname = 'web-chess-app.netlify.app';
      const warnClient = new ArcadeRealtimeClient({
        sessionCode: 'BJK-PBRUN',
        participantId: 'usr_warn'
      });
      warnClient.connect();
      const warnCb = mockESInstance.listeners['PB_CONNECT']?.[0];
      warnCb({ data: 'invalid-json' });

      // Test handleSessionEvent parse warning catch
      const sseWarnHandler = mockESInstance.listeners['session_events']?.[0];
      sseWarnHandler({ data: 'invalid-json' });

      // Test PocketBase EventSource creation failure catch
      (globalThis as any).EventSource = class BrokenPocketBaseES {
        constructor() {
          throw new Error('PocketBase stream blocked');
        }
      };
      let pbErrHandled = false;
      const brokenPbClient = new ArcadeRealtimeClient({
        sessionCode: 'BJK-PBRUN',
        participantId: 'usr_pb_broken',
        onError: () => { pbErrHandled = true; }
      });
      brokenPbClient.connect();
      expect(pbErrHandled).toBe(true);
    } finally {
      (globalThis as any).window = originalWindow;
      globalThis.fetch = originalFetch;
      (globalThis as any).EventSource = originalES;
    }
  });
});
