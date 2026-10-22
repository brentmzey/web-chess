import { beforeEach, describe, expect, it } from 'bun:test';
import { SanctuaryDatabase } from '../src/server/db/database';
import { SessionRepository } from '../src/server/db/sessionRepository';
import { SSEManager } from '../src/server/sse/sseManager';
import type { SessionEventRecord } from '../src/server/sse/sseTypes';

describe('SSEManager Connection Fan-Out & W3C EventSource Protocol', () => {
  let db: SanctuaryDatabase;
  let repo: SessionRepository;
  let sse: SSEManager;

  beforeEach(() => {
    db = new SanctuaryDatabase(':memory:');
    repo = new SessionRepository(db);
    sse = new SSEManager(repo);
  });

  it('formats SSE frames and keep-alive ping comments in accordance with W3C spec', () => {
    const rawFrame = sse.formatSSE({
      id: 5,
      event: 'move_made',
      data: { san: 'e4', ply: 1 },
      timestamp: 123456789
    });

    const text = new TextDecoder().decode(rawFrame);
    expect(text).toContain('id: 5\n');
    expect(text).toContain('event: move_made\n');
    expect(text).toContain('data: {"san":"e4","ply":1}\n\n');

    const ping = sse.formatKeepAlive();
    expect(new TextDecoder().decode(ping)).toBe(':keepalive\n\n');
  });

  it('subscribes clients, sends initial keepalive, and broadcasts events to all subscribers', () => {
    const messages1: string[] = [];
    const messages2: string[] = [];

    const mockController1 = {
      enqueue: (chunk: Uint8Array) => messages1.push(new TextDecoder().decode(chunk))
    } as any;

    const mockController2 = {
      enqueue: (chunk: Uint8Array) => messages2.push(new TextDecoder().decode(chunk))
    } as any;

    sse.subscribe('sess-1', 'part-1', mockController1);
    sse.subscribe('sess-1', 'part-2', mockController2);

    expect(sse.getSubscriberCount('sess-1')).toBe(2);
    expect(messages1[0]).toBe(':keepalive\n\n');
    expect(messages2[0]).toBe(':keepalive\n\n');

    const eventRecord: SessionEventRecord = {
      id: 'evt-1',
      session_id: 'sess-1',
      event_seq: 1,
      event_type: 'player_joined',
      payload_json: JSON.stringify({ role: 'white', name: 'Alice' }),
      created_at: Date.now()
    };

    sse.broadcast('sess-1', eventRecord);

    expect(messages1.length).toBe(2);
    expect(messages2.length).toBe(2);
    expect(messages1[1]).toContain('event: player_joined');
    expect(messages2[1]).toContain('event: player_joined');

    sse.unsubscribe('sess-1', 'part-1');
    expect(sse.getSubscriberCount('sess-1')).toBe(1);

    sse.unsubscribe('sess-1', 'part-2');
    expect(sse.getSubscriberCount('sess-1')).toBe(0);
  });

  it('replays missed events from database when lastEventId is provided on subscription', () => {
    const session = repo
      .createSession({ sessionCode: 'SANCT-REPLAY' })
      .getOrThrow();

    repo.recordEvent(session.id, 'session_created', { code: session.session_code });
    repo.recordEvent(session.id, 'player_joined', { role: 'white' });
    repo.recordEvent(session.id, 'move_made', { san: 'e4', ply: 1 });

    const messages: string[] = [];
    const mockController = {
      enqueue: (chunk: Uint8Array) => messages.push(new TextDecoder().decode(chunk))
    } as any;

    // Client reconnects specifying Last-Event-ID = 1 (should receive event 2 and 3)
    sse.subscribe(session.id, 'reconnect-part', mockController, 1);

    expect(messages.length).toBe(3); // 1 initial keepalive + 2 replayed events
    expect(messages[0]).toBe(':keepalive\n\n');
    expect(messages[1]).toContain('event: player_joined');
    expect(messages[1]).toContain('id: 2');
    expect(messages[2]).toContain('event: move_made');
    expect(messages[2]).toContain('id: 3');

    // Negative lastEventId should trigger false branch without error
    const noopCtrl = { enqueue: () => {} } as any;
    sse.subscribe(session.id, 'neg-part', noopCtrl, -1);
    expect(sse.getSubscriberCount(session.id)).toBe(2);
  });

  it('safely handles and evicts disconnected controllers on broadcast and heartbeat', async () => {
    let shouldThrow = false;
    const mockFaultyController = {
      enqueue: () => {
        if (shouldThrow) throw new Error('Client aborted SSE connection');
      }
    } as any;

    sse.subscribe('sess-err', 'part-faulty', mockFaultyController);
    expect(sse.getSubscriberCount('sess-err')).toBe(1);

    shouldThrow = true;
    const dummyEvent: SessionEventRecord = {
      id: 'e',
      session_id: 'sess-err',
      event_seq: 1,
      event_type: 'player_heartbeat',
      payload_json: '{}',
      created_at: Date.now()
    };

    sse.broadcast('sess-err', dummyEvent);
    expect(sse.getSubscriberCount('sess-err')).toBe(0);

    // Heartbeat tick test
    const pingMessages: string[] = [];
    const healthyController = {
      enqueue: (chunk: Uint8Array) => pingMessages.push(new TextDecoder().decode(chunk))
    } as any;
    sse.subscribe('sess-hb', 'part-healthy', healthyController);
    expect(sse.getSubscriberCount('sess-hb')).toBe(1);

    sse.sendHeartbeatTick();
    expect(pingMessages).toContain(':keepalive\n\n');

    // Heartbeat tick evicting broken controller
    const brokenController = {
      enqueue: () => {
        throw new Error('Broken pipe');
      }
    } as any;
    // Direct manual subscription simulation to test eviction on heartbeat
    sse.subscribe('sess-broken', 'part-broken', {
      enqueue: () => {}
    } as any);
    (sse as any).sessions.get('sess-broken')?.set('part-broken', {
      participantId: 'part-broken',
      controller: brokenController,
      connectedAt: Date.now()
    });
    sse.sendHeartbeatTick();
    expect(sse.getSubscriberCount('sess-broken')).toBe(0);

    // Heartbeat timer start and stop
    sse.startHeartbeat(10);
    // Double start is a safe no-op
    sse.startHeartbeat(10);
    await new Promise(r => setTimeout(r, 60));
    sse.stopHeartbeat();
  });
});
