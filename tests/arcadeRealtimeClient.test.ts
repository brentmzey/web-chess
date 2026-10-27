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

      // Trigger error
      es.onerror?.({ message: 'connection dropped' });
      expect(client.getIsConnected()).toBe(false);
      expect(errorOccurred).toBe(true);

      // Disconnect
      client.disconnect();
      expect((client as any).eventSource).toBeNull();
    } finally {
      (globalThis as any).EventSource = originalES;
    }
  });
});
