import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  ArcadeRealtimeClient,
  ARCADE_EVENTS_COLLECTION,
  ARCADE_TABLES_COLLECTION,
  TABLE_SNAPSHOT_SENDER,
  POCKETHOST_URL,
  arcadeSubscriptionTopic,
  arcadePrivateTopic,
  privateRecordId,
  ARCADE_PRIVATE_COLLECTION,
  type PrivateSeatState,
  type ArcadeConnectionStatus
} from '../src/realtime/arcadeRealtimeClient';
import { ArcadeGameEnum } from '../src/constants/gameEnums';

class MockEventSource {
  public static last: MockEventSource | null = null;
  public listeners: Record<string, ((e: any) => void)[]> = {};
  public onopen: (() => void) | null = null;
  public onerror: ((err: any) => void) | null = null;
  public closed = false;
  constructor(public url: string) {
    MockEventSource.last = this;
  }
  public addEventListener(evt: string,
                          fn: (e: any) => void) {
    this.listeners[evt] = this.listeners[evt] || [];
    this.listeners[evt]!.push(fn);
  }
  public emit(evt: string,
              e: any) {
    (this.listeners[evt] || []).forEach(fn => fn(e));
  }
  public close() {
    this.closed = true;
  }
}

interface FetchCall {
  readonly url: string;
  readonly body: any;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const jsonResponse = (body: unknown,
                      status: number = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ArcadeRealtimeClient', () => {
  const originalFetch = globalThis.fetch;
  const originalES = (globalThis as any).EventSource;
  const originalWindow = (globalThis as any).window;
  let calls: FetchCall[] = [];
  let lastHeaders: Record<string, string> = {};
  let responder: (url: string, body: any) => Response = () => jsonResponse({});

  beforeEach(() => {
    calls = [];
    responder = () => jsonResponse({});
    globalThis.fetch = mock(async (url: string, init?: any) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      lastHeaders = init?.headers ?? {};
      calls.push({ url: String(url), body });
      return responder(String(url), body);
    }) as any;
    (globalThis as any).EventSource = MockEventSource;
    MockEventSource.last = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).EventSource = originalES;
    (globalThis as any).window = originalWindow;
  });

  describe('environment resolution', () => {
    it('uses explicit base url, empty base without a window, and localhost detection', () => {
      (globalThis as any).window = undefined;
      expect(new ArcadeRealtimeClient({ sessionCode: 'BJK-A', participantId: 'p' }).getBaseUrl()).toBe('');

      const custom = new ArcadeRealtimeClient({ baseUrl: 'https://x.pockethost.io', sessionCode: 'BJK-A', participantId: 'p' });
      expect(custom.getBaseUrl()).toBe('https://x.pockethost.io');
      expect(custom.isPocketBaseMode()).toBe(true);

      (globalThis as any).window = { location: { hostname: 'localhost' } };
      expect(new ArcadeRealtimeClient({ sessionCode: 'BJK-A', participantId: 'p' }).getBaseUrl()).toBe('');
      (globalThis as any).window = { location: { hostname: '127.0.0.1' } };
      expect(new ArcadeRealtimeClient({ sessionCode: 'BJK-A', participantId: 'p' }).isPocketBaseMode()).toBe(false);

      (globalThis as any).window = { location: { hostname: 'web-chess.netlify.app' } };
      const remote = new ArcadeRealtimeClient({ sessionCode: 'BJK-A', participantId: 'p' });
      expect(remote.getBaseUrl()).toBe(POCKETHOST_URL);
      expect(new ArcadeRealtimeClient({ baseUrl: '/api/realtime', sessionCode: 'X-1', participantId: 'p' }).isPocketBaseMode()).toBe(true);
    });

    it('exposes identity accessors', () => {
      const client = new ArcadeRealtimeClient({ sessionCode: 'UNO-ID', participantId: 'usr_1' });
      expect(client.getParticipantId()).toBe('usr_1');
      expect(client.getSessionCode()).toBe('UNO-ID');
      expect(client.getClientId().isNone()).toBe(true);
      expect(client.getIsConnected()).toBe(false);
      expect(client.getLastEventSeq()).toBe(0);
    });

    it('builds a filtered PocketBase topic for one table', () => {
      const topic = arcadeSubscriptionTopic('BJK-T1');
      expect(topic.startsWith(`${ARCADE_EVENTS_COLLECTION}?options=`)).toBe(true);
      expect(JSON.parse(decodeURIComponent(topic.split('options=')[1]!))).toEqual({ query: { filter: 'session_code="BJK-T1"' } });
    });
  });

  describe('handlers', () => {
    it('dispatches to handlers, survives throwing handlers, and unsubscribes', () => {
      const client = new ArcadeRealtimeClient({ sessionCode: 'BJK-H', participantId: 'p' });
      const seen: unknown[] = [];
      const unsub = client.on('evt', d => seen.push(d));
      client.on('evt', () => {
        throw new Error('boom');
      });
      client.dispatchEvent('evt', 1, 1);
      client.dispatchEvent('nobody-listens', 1, 1);
      unsub();
      client.dispatchEvent('evt', 2, 2);
      expect(seen).toEqual([1]);
    });
  });

  describe('local Bun server mode', () => {
    const local = (extra: Record<string, unknown> = {}) =>
      new ArcadeRealtimeClient({ baseUrl: '', sessionCode: 'BJK-LOC', participantId: 'me', ...extra });

    it('connects, reports status, delivers peer events, and drops own echoes', () => {
      const statuses: ArcadeConnectionStatus[] = [];
      let opened = false;
      let errors = 0;
      const client = local({
        onOpen: () => { opened = true; },
        onError: () => { errors += 1; },
        onStatusChange: (s: ArcadeConnectionStatus) => statuses.push(s)
      });
      const received: unknown[] = [];
      client.on('action_dispatched', d => received.push(d));

      client.connect();
      const es = MockEventSource.last!;
      expect(es.url).toBe('/api/arcade/sessions/BJK-LOC/events?participantId=me');

      es.onerror?.({});
      expect(statuses).toEqual(['connecting', 'offline']);
      es.onopen?.();
      expect(opened).toBe(true);
      expect(client.getIsConnected()).toBe(true);

      es.emit('action_dispatched', { lastEventId: '4', data: JSON.stringify({ participantId: 'peer', actionType: 'hit' }) });
      es.emit('action_dispatched', { lastEventId: '5', data: JSON.stringify({ participantId: 'me', actionType: 'hit' }) });
      es.emit('action_dispatched', { lastEventId: '5', data: JSON.stringify({ participantId: 'me', actionType: 'state_sync', replayed: true }) });
      es.emit('action_dispatched', { lastEventId: 'x', data: 'plain text' });
      expect(received).toEqual([
        { participantId: 'peer', actionType: 'hit' },
        { participantId: 'me', actionType: 'state_sync', replayed: true },
        'plain text'
      ]);
      expect(client.getLastEventSeq()).toBe(5);

      // Listeners registered after connecting are wired to the open stream
      const late: unknown[] = [];
      client.on('seat_claimed', d => late.push(d));
      es.emit('seat_claimed', { lastEventId: '6', data: 'null' });
      expect(late).toEqual([null]);

      es.onerror?.({});
      expect(statuses.at(-1)).toBe('reconnecting');
      expect(errors).toBe(2);

      // Reconnect resumes from the last seen event id
      client.connect();
      expect(es.closed).toBe(true);
      expect(MockEventSource.last!.url).toContain('lastEventId=6');
      client.disconnect();
      expect(client.getIsConnected()).toBe(false);
    });

    it('reconnects with backoff when the browser gives up on the stream, and stops after disconnect', async () => {
      const client = local();
      client.connect();
      const first = MockEventSource.last!;
      first.onopen?.();

      // A transient drop the browser retries by itself: no manual reconnect
      (first as any).readyState = 0;
      first.onerror?.({});
      await new Promise(r => setTimeout(r, 1100));
      expect(MockEventSource.last).toBe(first);

      // The browser gave up (proxy error page): reconnect after the base backoff
      (first as any).readyState = 2;
      first.onerror?.({});
      first.onerror?.({});
      await new Promise(r => setTimeout(r, 1100));
      const second = MockEventSource.last!;
      expect(second).not.toBe(first);
      expect(first.closed).toBe(true);

      // A user disconnect cancels a pending reconnect
      (second as any).readyState = 2;
      second.onerror?.({});
      client.disconnect();
      await new Promise(r => setTimeout(r, 1100));
      expect(MockEventSource.last).toBe(second);

      // Errors after a user disconnect never schedule a reconnect
      second.onerror?.({});
      await new Promise(r => setTimeout(r, 1100));
      expect(MockEventSource.last).toBe(second);
    });

    it('reports offline when the EventSource cannot be created', () => {
      (globalThis as any).EventSource = class {
        constructor() {
          throw new Error('blocked');
        }
      };
      const statuses: ArcadeConnectionStatus[] = [];
      let errored = false;
      const client = local({ onError: () => { errored = true; }, onStatusChange: (s: ArcadeConnectionStatus) => statuses.push(s) });
      client.connect();
      expect(errored).toBe(true);
      expect(statuses).toEqual(['connecting', 'offline']);
    });

    it('posts seat, kick, and action requests and passes the game for table creation', async () => {
      responder = url =>
        url.endsWith('/join') ? jsonResponse({ seatNumber: 2, sessionCode: 'BJK-LOC' }) : jsonResponse({ message: 'ok', event: {} });

      const withGame = local({ game: ArcadeGameEnum.Blackjack });
      expect((await withGame.claimSeat('Ana')).getOrThrow().seatNumber).toBe(2);
      expect(calls[0]!.body).toEqual({ sessionCode: 'BJK-LOC', participantId: 'me', displayName: 'Ana', game: 'blackjack' });

      const withoutGame = local();
      await withoutGame.claimSeat('Bo');
      expect(calls[1]!.body.game).toBeUndefined();

      expect((await withoutGame.leaveSeat()).isSuccess()).toBe(true);
      await withoutGame.kickPlayer('peer');
      expect(calls[3]!.body).toEqual({ sessionCode: 'BJK-LOC', hostParticipantId: 'me', targetParticipantId: 'peer', reason: 'Removed by match host' });
      await withoutGame.kickPlayer('peer', 'Rude');
      expect(calls[4]!.body.reason).toBe('Rude');
      expect((await withoutGame.dispatchAction('hit')).isSuccess()).toBe(true);
      expect(calls[5]!.url).toBe('/api/arcade/sessions/action');
      expect(calls[5]!.body.payload).toEqual({});
    });

    it('surfaces server errors, PocketBase validation details, and bare HTTP failures', async () => {
      const client = local();
      responder = () => jsonResponse({ error: 'Table is full' }, 400);
      expect((await client.claimSeat('A')).isFailure()).toBe(true);
      expect((await client.claimSeat('A')).match({ Ok: () => '', Err: e => e })).toBe('Table is full');

      responder = () => jsonResponse({ message: 'Failed.', data: { session_code: { message: 'Cannot be blank.' }, other: {} } }, 400);
      expect((await client.leaveSeat()).match({ Ok: () => '', Err: e => e })).toBe('Failed. session_code: Cannot be blank., other: invalid');

      responder = () => new Response('not json', { status: 503 });
      expect((await client.kickPlayer('x')).match({ Ok: () => '', Err: e => e })).toBe('Failed to kick player: HTTP 503');
      expect((await client.sendAction('a', {})).match({ Ok: () => '', Err: e => e })).toBe('Failed to send action: HTTP 503');

      globalThis.fetch = mock(async () => {
        throw 'socket closed';
      }) as any;
      expect((await client.sendAction('a', {})).match({ Ok: () => '', Err: e => e })).toBe('socket closed');
    });
  });

  describe('PocketHost mode', () => {
    const remote = (extra: Record<string, unknown> = {}) =>
      new ArcadeRealtimeClient({ baseUrl: POCKETHOST_URL, sessionCode: 'BJK-PB', participantId: 'me', ...extra });
    const topic = arcadeSubscriptionTopic('BJK-PB');
    const record = (over: Record<string, unknown>) => ({
      data: JSON.stringify({ action: 'create', record: { session_code: 'BJK-PB', participant_id: 'peer', event_type: 'action_dispatched', ...over } })
    });

    it('subscribes to the filtered topic on connect and replays missed events on reconnect', async () => {
      const statuses: ArcadeConnectionStatus[] = [];
      let opens = 0;
      const client = remote({ onOpen: () => { opens += 1; }, onStatusChange: (s: ArcadeConnectionStatus) => statuses.push(s) });
      const received: any[] = [];
      client.on('action_dispatched', d => received.push(d));

      client.connect();
      const es = MockEventSource.last!;
      expect(es.url).toBe(`${POCKETHOST_URL}/api/realtime`);

      es.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c1' }) });
      await flush();
      expect(calls[0]!.body).toEqual({ clientId: 'c1', subscriptions: [topic, arcadePrivateTopic('BJK-PB')] });
      expect(client.getClientId().getOrElse('')).toBe('c1');
      expect(statuses).toEqual(['connecting', 'live']);
      // First connect also loads the server-kept table snapshot (none yet)
      expect(calls.length).toBe(2);
      expect(calls[1]!.url).toContain(`/api/collections/${ARCADE_TABLES_COLLECTION}/records`);

      es.emit(topic, record({ id: 'r1', event_seq: 10, payload: { n: 1 } }));
      expect(received).toEqual([{ n: 1 }]);

      es.onerror?.({});
      expect(statuses.at(-1)).toBe('reconnecting');

      responder = url =>
        url.includes(`${ARCADE_EVENTS_COLLECTION}/records`)
          ? jsonResponse({ items: [{ id: 'r1', session_code: 'BJK-PB', participant_id: 'peer', event_type: 'action_dispatched', event_seq: 10, payload: { n: 1 } },
                                   { id: 'r2', session_code: 'BJK-PB', participant_id: 'peer', event_type: 'action_dispatched', event_seq: 11, payload: '{"n":2}' }] })
          : jsonResponse({});
      es.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c2' }) });
      await flush();
      await flush();
      const replayCall = calls.find(c => c.url.includes(`${ARCADE_EVENTS_COLLECTION}/records`))!;
      expect(decodeURIComponent(replayCall.url)).toContain('session_code="BJK-PB" && event_seq > 10');
      expect(received).toEqual([{ n: 1 }, { n: 2 }]);
      expect(opens).toBe(2);

      // Reconnect with no missed events
      responder = () => jsonResponse({});
      es.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c3' }) });
      await flush();
      await flush();
      expect(received.length).toBe(2);
    });

    it('filters duplicates, other tables, own echoes, deletes, and malformed messages', () => {
      const client = remote();
      const received: unknown[] = [];
      client.on('action_dispatched', d => received.push(d));
      client.connect();
      const es = MockEventSource.last!;

      es.emit(topic, record({ id: 'a', event_seq: 5, payload: 1 }));
      es.emit(topic, record({ id: 'a', event_seq: 5, payload: 1 }));
      es.emit(topic, record({ id: 'b', session_code: 'OTHER-1', event_seq: 6, payload: 2 }));
      es.emit(topic, record({ id: 'c', participant_id: 'me', event_seq: 7, payload: 3 }));
      es.emit(topic, record({ payload: 4 }));
      es.emit(topic, { data: JSON.stringify({ action: 'delete', record: { session_code: 'BJK-PB' } }) });
      es.emit(topic, { data: 'garbage' });
      es.emit(topic, { data: JSON.stringify({ action: 'create' }) });

      expect(received).toEqual([1, 4]);
      expect(client.getLastEventSeq()).toBe(8);
    });

    it('reports subscription rejections, bad handshakes, and replay failures', async () => {
      const errors: unknown[] = [];
      const client = remote({ onError: (e: unknown) => errors.push(e) });
      client.connect();
      const es = MockEventSource.last!;

      responder = () => jsonResponse({ message: 'Forbidden.' }, 403);
      es.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c1' }) });
      await flush();
      expect(errors).toEqual(['Forbidden.']);

      es.emit('PB_CONNECT', { data: 'not json' });
      await flush();
      expect(errors.length).toBe(2);

      responder = () => jsonResponse({});
      es.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c2' }) });
      await flush();
      responder = url => (url.includes('/records') ? jsonResponse({}, 500) : jsonResponse({}));
      es.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c3' }) });
      await flush();
      await flush();
      expect(errors.length).toBe(2);
      expect((await client.replayMissedEvents()).match({ Ok: () => '', Err: e => e })).toBe('Failed to replay missed events: HTTP 500');
    });

    it('hydrates a late joiner from the server-kept table snapshot', async () => {
      const client = remote();
      const received: any[] = [];
      client.on('action_dispatched', d => received.push(d));

      responder = () => jsonResponse({ items: [{ id: 't1', session_code: 'BJK-PB', status: 'active', json_last_snapshot: { version: 1, state: {} } }] });
      expect((await client.hydrateFromTableSnapshot()).getOrThrow()).toBe(true);
      expect(received[0]).toEqual({ sessionCode: 'BJK-PB', participantId: TABLE_SNAPSHOT_SENDER, actionType: 'state_sync', payload: { version: 1, state: {} } });
      expect(decodeURIComponent(calls[0]!.url)).toContain('session_code="BJK-PB"');

      responder = () => jsonResponse({ items: [{ id: 't1', session_code: 'BJK-PB', status: 'open' }] });
      expect((await client.hydrateFromTableSnapshot()).getOrThrow()).toBe(false);
      responder = () => jsonResponse({ items: [{ id: 't1', session_code: 'BJK-PB', status: 'bogus' }] });
      expect((await client.hydrateFromTableSnapshot()).getOrThrow()).toBe(false);
      responder = () => jsonResponse({ items: 'not a list' });
      expect((await client.hydrateFromTableSnapshot()).getOrThrow()).toBe(false);
      responder = () => jsonResponse({}, 500);
      expect((await client.hydrateFromTableSnapshot()).isFailure()).toBe(true);
      expect(received.length).toBe(1);

      // A failed snapshot load on first connect is reported but does not block going live
      const statuses: ArcadeConnectionStatus[] = [];
      const other = remote({ onStatusChange: (st: ArcadeConnectionStatus) => statuses.push(st) });
      responder = url => (url.includes(ARCADE_TABLES_COLLECTION) ? jsonResponse({}, 500) : jsonResponse({}));
      other.connect();
      MockEventSource.last!.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c9' }) });
      await flush();
      await flush();
      expect(statuses).toEqual(['connecting', 'live']);
    });

    it('drops records that fail schema validation', () => {
      const client = remote();
      const received: unknown[] = [];
      client.on('action_dispatched', d => received.push(d));
      client.ingestRecord({ session_code: 'BJK-PB', event_type: '' });
      client.ingestRecord({ event_type: 'action_dispatched' });
      client.ingestRecord(null);
      expect(received).toEqual([]);
    });

    it('publishes seat, kick, and action events as tbl_arcade_events records', async () => {
      const client = remote({ game: ArcadeGameEnum.Poker });
      expect((await client.claimSeat('Ana')).getOrThrow().seatNumber).toBe(1);
      expect((await client.leaveSeat()).getOrThrow().message).toBe('Participant vacated');
      expect((await client.kickPlayer('peer')).getOrThrow().kickedParticipantId).toBe('peer');
      await client.kickPlayer('peer', 'Rude');
      expect((await client.sendAction('poker_deal', { a: 1 })).isSuccess()).toBe(true);

      expect(calls.every(c => c.url === `${POCKETHOST_URL}/api/collections/${ARCADE_EVENTS_COLLECTION}/records`)).toBe(true);
      expect(calls.map(c => c.body.event_type)).toEqual(['seat_claimed', 'seat_left', 'player_kicked', 'player_kicked', 'action_dispatched']);
      expect(calls[0]!.body).toMatchObject({ session_code: 'BJK-PB', game_key: 'poker', participant_id: 'me', payload: { participantId: 'me', displayName: 'Ana' } });
      expect(calls[2]!.body.payload.reason).toBe('Removed by match host');
      expect(calls[3]!.body.payload.reason).toBe('Rude');
      const seqs = calls.map(c => c.body.event_seq as number);
      expect(seqs.every((seq, i) => i === 0 || seq > seqs[i - 1]!)).toBe(true);

      const noGame = remote();
      await noGame.sendAction('x', {});
      expect(calls.at(-1)!.body.game_key).toBe('');

      responder = () => jsonResponse({ message: 'Failed to create record.', data: { session_code: { message: 'Invalid' } } }, 400);
      expect((await client.claimSeat('Ana')).match({ Ok: () => '', Err: e => e })).toBe('Failed to create record. session_code: Invalid');
      expect((await client.leaveSeat()).isFailure()).toBe(true);
      expect((await client.kickPlayer('peer')).isFailure()).toBe(true);
      expect((await client.sendAction('x', {})).isFailure()).toBe(true);
    });
  });

  describe('private seat state (PocketHost)', () => {
    const authed = (extra: Record<string, unknown> = {}) =>
      new ArcadeRealtimeClient({ baseUrl: POCKETHOST_URL, sessionCode: 'UNO-PRV', participantId: 'usr_me', authToken: 'tok_me', ...extra });
    const privateRecord = (over: Record<string, unknown> = {}) => ({
      id: 'abc', session_code: 'UNO-PRV', owner: 'usr_me', seat_key: 'p2', int_state_seq: 3, json_secrets: { hand: ['R7'] }, ...over
    });

    it('derives a stable 15-character record id per table and player', () => {
      const id = privateRecordId('UNO-PRV', 'usr_me');
      expect(id).toMatch(/^[a-z0-9]{15}$/);
      expect(privateRecordId('UNO-PRV', 'usr_me')).toBe(id);
      expect(privateRecordId('UNO-PRV', 'usr_you')).not.toBe(id);
      expect(privateRecordId('UNO-OTHER', 'usr_me')).not.toBe(id);
    });

    it('sends the auth token, subscribes to the private topic, and delivers only own secrets', async () => {
      const client = authed();
      const got: PrivateSeatState[] = [];
      client.on<PrivateSeatState>('private_state', d => got.push(d));
      responder = url => (url.includes(ARCADE_PRIVATE_COLLECTION) ? jsonResponse({ items: [privateRecord({ int_state_seq: 1 })] }) : jsonResponse({}));
      client.connect();
      const es = MockEventSource.last!;
      es.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c1' }) });
      await flush();
      await flush();
      const sub = calls.find(c => c.url.endsWith('/api/realtime'))!;
      expect(sub.body.subscriptions).toContain(arcadePrivateTopic('UNO-PRV'));
      expect(got[0]).toEqual({ seatKey: 'p2', stateSeq: 1, secrets: { hand: ['R7'] } });

      const privTopic = arcadePrivateTopic('UNO-PRV');
      es.emit(privTopic, { data: JSON.stringify({ action: 'update', record: privateRecord({ int_state_seq: 4, json_secrets: null }) }) });
      es.emit(privTopic, { data: JSON.stringify({ action: 'update', record: privateRecord({ owner: 'usr_other' }) }) });
      es.emit(privTopic, { data: JSON.stringify({ action: 'update', record: privateRecord({ session_code: 'UNO-ELSE' }) }) });
      es.emit(privTopic, { data: JSON.stringify({ action: 'delete', record: privateRecord() }) });
      es.emit(privTopic, { data: 'garbage' });
      client.ingestPrivateRecord({ nope: true });
      expect(got.map(g => g.stateSeq)).toEqual([1, 4]);
      expect(got[1]!.secrets).toEqual({});

      await client.sendAction('uno_draw', {});
      expect(lastHeaders.Authorization).toBe('tok_me');
    });

    it('skips private hydration without a token or outside PocketHost, and reports failures', async () => {
      expect((await new ArcadeRealtimeClient({ baseUrl: POCKETHOST_URL, sessionCode: 'UNO-PRV', participantId: 'x' }).hydratePrivateState()).getOrThrow()).toBe(false);
      expect((await authed({ baseUrl: '' }).hydratePrivateState()).getOrThrow()).toBe(false);
      responder = () => jsonResponse({}, 500);
      expect((await authed().hydratePrivateState()).isFailure()).toBe(true);
      responder = () => jsonResponse({ items: [] });
      expect((await authed().hydratePrivateState()).getOrThrow()).toBe(false);
    });

    it('updates the private record in place, creating it with the table relation on first use', async () => {
      const client = authed();
      const id = privateRecordId('UNO-PRV', 'usr_guest');
      let exists = false;
      responder = (url, body) => {
        if (url.endsWith(`/${id}`)) return exists ? jsonResponse({ id }) : jsonResponse({ message: 'Not found.' }, 404);
        if (url.includes('tbl_arcade_tables')) return jsonResponse({ items: [{ id: 'tbl_123', session_code: 'UNO-PRV', status: 'active' }] });
        if (url.endsWith(`/${ARCADE_PRIVATE_COLLECTION}/records`)) {
          exists = true;
          return jsonResponse({ id: body.id });
        }
        return jsonResponse({});
      };
      expect((await client.publishPrivate('usr_guest', 'p2', 5, { hand: ['B2'] })).isSuccess()).toBe(true);
      const create = calls.find(c => c.url.endsWith(`/${ARCADE_PRIVATE_COLLECTION}/records`))!;
      expect(create.body).toEqual({ id, table: 'tbl_123', owner: 'usr_guest', session_code: 'UNO-PRV', seat_key: 'p2', int_state_seq: 5, json_secrets: { hand: ['B2'] } });

      calls = [];
      expect((await client.publishPrivate('usr_guest', 'p2', 6, { hand: [] })).isSuccess()).toBe(true);
      expect(calls.length).toBe(1);
      expect(calls[0]!.body).toEqual({ seat_key: 'p2', int_state_seq: 6, json_secrets: { hand: [] } });

      // The table id is cached after the first lookup
      exists = false;
      calls = [];
      await client.publishPrivate('usr_third', 'p3', 7, {});
      expect(calls.some(c => c.url.includes('tbl_arcade_tables'))).toBe(false);
    });

    it('reports private publish failures and is a no-op on the local server', async () => {
      expect((await authed({ baseUrl: '' }).publishPrivate('u', 'p1', 1, {})).isSuccess()).toBe(true);
      expect(calls.length).toBe(0);

      responder = () => jsonResponse({ message: 'Forbidden.' }, 403);
      expect((await authed().publishPrivate('u', 'p1', 1, {})).match({ Ok: () => '', Err: e => e })).toBe('Forbidden.');

      responder = url => (url.includes('tbl_arcade_tables') ? jsonResponse({ items: [] }) : jsonResponse({}, 404));
      expect((await authed().publishPrivate('u', 'p1', 1, {})).match({ Ok: () => '', Err: e => e })).toBe('This live table is not registered yet.');

      responder = url => (url.includes('tbl_arcade_tables') ? jsonResponse({}, 500) : jsonResponse({}, 404));
      expect((await authed().publishPrivate('u', 'p1', 1, {})).isFailure()).toBe(true);

      responder = (url, body) => (url.includes('tbl_arcade_tables') ? jsonResponse({ items: [{ id: 't1' }] }) : body?.id ? jsonResponse({ message: 'Bad.' }, 400) : jsonResponse({}, 404));
      expect((await authed().publishPrivate('u', 'p1', 1, {})).match({ Ok: () => '', Err: e => e })).toBe('Bad.');
    });
  });
});

