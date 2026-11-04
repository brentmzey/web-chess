import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { SanctuaryDatabase } from '../src/server/db/database';
import { SessionRepository } from '../src/server/db/sessionRepository';
import { RealtimeChessService } from '../src/server/services/realtimeChessService';
import { SSEManager } from '../src/server/sse/sseManager';
import {
  LiveChatClient,
  sanitizeChatMessage,
  chatMessagesTopic,
  POCKETHOST_URL,
  CHAT_COLLECTION
} from '../src/realtime/liveChatClient';
import {
  parseChatMessageInput,
  parseChatMessageRecord,
  type ChatMessageRecordData
} from '../src/validation/chatSchemas';

describe('Sanctuary Live Chat System - Schemas, Repository, Service & Client', () => {
  it('validates chat input schema properly', () => {
    const valid = parseChatMessageInput({
      sessionCode: 'SANCT-TEST',
      senderId: 'usr_1',
      senderName: 'White Knight',
      senderRole: 'white',
      message: 'Greetings from the crossing altar!'
    });
    expect(valid.match({ Ok: () => true, Err: () => false })).toBe(true);

    const invalidEmptyMsg = parseChatMessageInput({
      sessionCode: 'SANCT-TEST',
      senderId: 'usr_1',
      senderName: 'White Knight',
      senderRole: 'white',
      message: '   '
    });
    expect(invalidEmptyMsg.match({ Ok: () => false, Err: () => true })).toBe(true);

    const invalidMissingCode = parseChatMessageInput({
      sessionCode: '',
      senderId: 'usr_1',
      senderName: 'White Knight',
      senderRole: 'white',
      message: 'Hello'
    });
    expect(invalidMissingCode.match({ Ok: () => false, Err: () => true })).toBe(true);

    const invalidLongMsg = parseChatMessageInput({
      sessionCode: 'SANCT-TEST',
      senderId: 'usr_1',
      senderName: 'White Knight',
      senderRole: 'white',
      message: 'x'.repeat(501)
    });
    expect(invalidLongMsg.match({ Ok: () => false, Err: () => true })).toBe(true);
  });

  it('validates and parses ChatMessageRecord properly', () => {
    const record = parseChatMessageRecord({
      id: 'msg_1',
      txt_session_code: 'SANCT-TEST',
      txt_sender_id: 'usr_1',
      txt_sender_name: 'Bishop',
      txt_sender_role: 'spectator',
      txt_message: 'Well played!',
      int_created_at: 123456789
    });
    expect(record.match({ Ok: () => true, Err: () => false })).toBe(true);
    expect(record.getOrElse({} as ChatMessageRecordData).txt_message).toBe('Well played!');

    const invalidRecord = parseChatMessageRecord({
      id: ''
    });
    expect(invalidRecord.match({ Ok: () => false, Err: () => true })).toBe(true);
  });

  it('sanitizes HTML tags and limits message length', () => {
    expect(sanitizeChatMessage('<script>alert("xss")</script>Hello World')).toBe('Hello World');
    expect(sanitizeChatMessage('<b>Bold</b> <i>Gothic</i>')).toBe('Bold Gothic');
    expect(sanitizeChatMessage('a'.repeat(600), 10)).toBe('a'.repeat(10));
  });

  it('generates the correct PocketBase chat topic', () => {
    const topic = chatMessagesTopic('SANCT-1234');
    expect(topic).toContain('tbl_chat_messages');
    expect(topic).toContain('SANCT-1234');
  });

  it('inserts and retrieves chat messages via SessionRepository', () => {
    const db = new SanctuaryDatabase(':memory:');
    const repo = new SessionRepository(db);

    const sessionRes = repo.createSession({
      sessionCode: 'SANCT-CHAT',
      theme: 'gothic-basilica'
    });
    expect(sessionRes.match({ Ok: () => true, Err: () => false })).toBe(true);
    const session = sessionRes.getOrElse(null as any);

    const insertRes = repo.insertChatMessage({
      id: 'msg-rep-1',
      sessionId: session.id,
      sessionCode: 'SANCT-CHAT',
      senderId: 'user_w',
      senderName: 'Marble Host',
      senderRole: 'white',
      message: 'En garde!',
      createdAt: 1000
    });
    expect(insertRes.match({ Ok: () => true, Err: () => false })).toBe(true);

    const insertRes2 = repo.insertChatMessage({
      id: 'msg-rep-2',
      sessionId: session.id,
      sessionCode: 'SANCT-CHAT',
      senderId: 'user_b',
      senderName: 'Obsidian Guest',
      senderRole: 'black',
      message: 'With pleasure.',
      createdAt: 2000
    });
    expect(insertRes2.match({ Ok: () => true, Err: () => false })).toBe(true);

    const messages = repo.getChatMessagesBySessionCode('SANCT-CHAT', 10);
    expect(messages.length).toBe(2);
    expect(messages[0]!.txt_message).toBe('En garde!');
    expect(messages[1]!.txt_message).toBe('With pleasure.');
    expect(messages[0]!.txt_sender_role).toBe('white');
    expect(messages[1]!.txt_sender_role).toBe('black');

    db.close();
  });

  it('sends and retrieves chat messages via RealtimeChessService with SSE broadcast', () => {
    const db = new SanctuaryDatabase(':memory:');
    const repo = new SessionRepository(db);
    const sse = new SSEManager(repo);
    const service = new RealtimeChessService(repo, sse);

    const sessionData = service.createSession({}).getOrElse(null as any);
    expect(sessionData).toBeTruthy();
    const currentSession = sessionData.session;
    const participant = sessionData.participant;

    const broadcastSpy = mock();
    (sse as any).broadcast = broadcastSpy;

    const chatRes = service.sendChatMessage({
      sessionId: currentSession.id,
      sessionCode: currentSession.session_code,
      senderId: participant.id,
      senderName: 'Host',
      senderRole: 'white',
      message: 'Hello opponent!'
    });

    expect(chatRes.match({ Ok: () => true, Err: () => false })).toBe(true);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    const history = service.getChatMessages(currentSession.session_code);
    expect(history.length).toBe(1);
    expect(history[0]!.txt_message).toBe('Hello opponent!');

    // Test rejection of empty message
    const emptyRes = service.sendChatMessage({
      sessionId: currentSession.id,
      sessionCode: currentSession.session_code,
      senderId: participant.id,
      senderName: 'Host',
      senderRole: 'white',
      message: '   '
    });
    expect(emptyRes.match({ Ok: () => false, Err: () => true })).toBe(true);

    db.close();
  });

  it('stores a chat message without a session relation and skips broadcast when sessionId does not resolve', () => {
    const db = new SanctuaryDatabase(':memory:');
    const repo = new SessionRepository(db);
    const sse = new SSEManager(repo);
    const service = new RealtimeChessService(repo, sse);

    const broadcastSpy = mock();
    (sse as any).broadcast = broadcastSpy;

    const chatRes = service.sendChatMessage({
      sessionId: 'does_not_exist_in_this_db',
      sessionCode: 'SANCT-ORPHAN',
      senderId: 'user_1',
      senderName: 'Wanderer',
      senderRole: 'spectator',
      message: 'Hello from a stale session id'
    });

    expect(chatRes.match({ Ok: () => true, Err: () => false })).toBe(true);
    expect(broadcastSpy).not.toHaveBeenCalled();

    const history = service.getChatMessages('SANCT-ORPHAN');
    expect(history.length).toBe(1);
    expect(history[0]!.session_id).toBeFalsy();

    db.close();
  });

  it('manages LiveChatClient state, unread counts, and listeners', async () => {
    const client = new LiveChatClient({
      baseUrl: 'http://localhost:3000',
      sessionCode: 'SANCT-UNIT',
      senderName: 'Alice',
      senderRole: 'spectator',
      senderId: 'user_spec_1'
    });

    expect(client.getSenderName()).toBe('Alice');
    expect(client.getSenderRole()).toBe('spectator');
    expect(client.getSenderId()).toBe('user_spec_1');
    expect(client.getSessionCode().getOrElse('')).toBe('SANCT-UNIT');
    expect(client.getUnreadCount()).toBe(0);

    client.incrementUnreadCount();
    client.incrementUnreadCount();
    expect(client.getUnreadCount()).toBe(2);

    client.resetUnreadCount();
    expect(client.getUnreadCount()).toBe(0);

    const received: ChatMessageRecordData[] = [];
    const unsubscribe = client.onMessage(msg => {
      received.push(msg);
    });

    const testMsg: ChatMessageRecordData = {
      id: 'msg_test_1',
      txt_session_code: 'SANCT-UNIT',
      txt_sender_id: 'user_w',
      txt_sender_name: 'Bob',
      txt_sender_role: 'white',
      txt_message: 'Welcome spectator!',
      int_created_at: 5000
    };

    client.handleIncomingMessage(testMsg);
    expect(received.length).toBe(1);
    expect(client.getMessages().length).toBe(1);

    // Duplicate message suppression
    client.handleIncomingMessage(testMsg);
    expect(received.length).toBe(1);
    expect(client.getMessages().length).toBe(1);

    unsubscribe();
    client.handleIncomingMessage({
      ...testMsg,
      id: 'msg_test_2'
    });
    expect(received.length).toBe(1); // Listener did not receive because unsubscribed
    expect(client.getMessages().length).toBe(2);

    client.disconnect();
    expect(client.getMessages().length).toBe(0);
    expect(client.getSessionCode().isNone()).toBe(true);
  });

  it('fails cleanly when sending chat without session code', async () => {
    const client = new LiveChatClient();
    const res = await client.sendMessage('Hello');
    expect(res.match({ Ok: () => false, Err: () => true })).toBe(true);

    const emptyRes = await client.sendMessage('');
    expect(emptyRes.match({ Ok: () => false, Err: () => true })).toBe(true);
  });

  it('fetches history and sends message in local mode via fetch', async () => {
    const client = new LiveChatClient({
      baseUrl: 'http://localhost:3000',
      sessionCode: 'SANCT-FETCH',
      senderName: 'Tester',
      senderRole: 'white'
    });

    const originalFetch = globalThis.fetch;
    const mockMessages: ChatMessageRecordData[] = [
      {
        id: 'msg_h1',
        txt_session_code: 'SANCT-FETCH',
        txt_sender_id: 'u1',
        txt_sender_name: 'Player 1',
        txt_sender_role: 'white',
        txt_message: 'Historic Message',
        int_created_at: 1000
      }
    ];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/chat/messages/SANCT-FETCH')) {
        return new Response(JSON.stringify({ messages: mockMessages }), { status: 200 });
      }
      if (urlStr.includes('/api/chat/messages') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({
          message: {
            id: 'msg_sent_1',
            txt_session_code: body.sessionCode,
            txt_sender_id: body.senderId,
            txt_sender_name: body.senderName,
            txt_sender_role: body.senderRole,
            txt_message: body.message,
            int_created_at: body.createdAt
          }
        }), { status: 201 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    try {
      const histRes = await client.fetchHistory();
      expect(histRes.match({ Ok: () => true, Err: () => false })).toBe(true);
      expect(client.getMessages().length).toBe(1);

      const sendRes = await client.sendMessage('Testing fetch send');
      expect(sendRes.match({ Ok: () => true, Err: () => false })).toBe(true);
      expect(client.getMessages().length).toBe(2);
      expect(client.getMessages()[1]!.txt_message).toBe('Testing fetch send');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sends messages through verbatim with no profanity filtering, only HTML stripped', async () => {
    const client = new LiveChatClient({
      baseUrl: 'http://localhost:3000',
      sessionCode: 'SANCT-UNFILTERED',
      senderName: 'Tester',
      senderRole: 'white'
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({
        message: {
          id: `msg_${body.message}`,
          txt_session_code: body.sessionCode,
          txt_sender_id: body.senderId,
          txt_sender_name: body.senderName,
          txt_sender_role: body.senderRole,
          txt_message: body.message,
          int_created_at: body.createdAt
        }
      }), { status: 201 });
    }) as any;

    try {
      const res = await client.sendMessage('this is such bullshit, you fucking cheated');
      expect(res.match({ Ok: () => true, Err: () => false })).toBe(true);
      expect(res.getOrElse(null as any).txt_message).toBe('this is such bullshit, you fucking cheated');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetches history and sends message in PocketBase mode via fetch', async () => {
    const client = new LiveChatClient({
      baseUrl: 'https://web-chess.pockethost.io',
      sessionCode: 'SANCT-PB',
      senderName: 'PB Player',
      senderRole: 'player',
      authToken: 'test-token'
    });

    // Force non-local mode
    (client as any).isLocalMode = () => false;

    const originalFetch = globalThis.fetch;
    const mockPbItems = [
      {
        id: 'msg_pb_1',
        txt_session_code: 'SANCT-PB',
        txt_sender_id: 'pb_u1',
        txt_sender_name: 'Host',
        txt_sender_role: 'host',
        txt_message: 'Welcome to PocketBase chat!',
        int_created_at: 2000
      }
    ];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/collections/tbl_chat_messages/records') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({
          id: 'msg_pb_new',
          ...body
        }), { status: 200 });
      }
      if (urlStr.includes('/api/collections/tbl_chat_messages/records')) {
        return new Response(JSON.stringify({ items: mockPbItems }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    try {
      const histRes = await client.fetchHistory();
      expect(histRes.match({ Ok: () => true, Err: () => false })).toBe(true);
      expect(client.getMessages().length).toBe(1);

      const sendRes = await client.sendMessage('Live PB chat message');
      expect(sendRes.match({ Ok: () => true, Err: () => false })).toBe(true);
      expect(client.getMessages().length).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles network failure gracefully on fetchHistory and sendMessage', async () => {
    const client = new LiveChatClient({
      baseUrl: 'http://localhost:3000',
      sessionCode: 'SANCT-FAIL',
      senderName: 'Tester',
      senderRole: 'white'
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response('Network error', { status: 500 });
    }) as any;

    try {
      const histRes = await client.fetchHistory();
      expect(histRes.match({ Ok: () => false, Err: () => true })).toBe(true);

      const sendRes = await client.sendMessage('Will fail');
      expect(sendRes.match({ Ok: () => false, Err: () => true })).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('LiveChatClient - connectSSE, setSession, and remaining branch coverage', () => {
  class MockEventSource {
    public static last: MockEventSource | null = null;
    public listeners: Record<string, ((e: any) => void)[]> = {};
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
                e: any = {}) {
      (this.listeners[evt] || []).forEach(fn => fn(e));
    }
    public close() {
      this.closed = true;
    }
  }

  interface FetchCall {
    readonly url: string;
    readonly init?: any;
  }

  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  const originalFetch = globalThis.fetch;
  const originalES = (globalThis as any).EventSource;
  const originalWindow = (globalThis as any).window;
  let calls: FetchCall[] = [];
  let responder: (url: string, init?: any) => Response = () => new Response(JSON.stringify({}), { status: 200 });

  beforeEach(() => {
    calls = [];
    responder = () => new Response(JSON.stringify({}), { status: 200 });
    globalThis.fetch = mock(async (url: string | URL | Request, init?: any) => {
      calls.push({ url: String(url), init });
      return responder(String(url), init);
    }) as any;
    (globalThis as any).EventSource = MockEventSource;
    MockEventSource.last = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).EventSource = originalES;
    (globalThis as any).window = originalWindow;
  });

  it('exposes getBaseUrl (trimmed) and defaults getIsConnected to false', () => {
    const client = new LiveChatClient({ baseUrl: 'http://localhost:3000/' });
    expect(client.getBaseUrl()).toBe('http://localhost:3000');
    expect(client.getIsConnected()).toBe(false);
  });

  it('defaults the base URL from window.location when none is configured, mirroring ArcadeRealtimeClient', () => {
    (globalThis as any).window = { location: { hostname: 'localhost' } };
    expect(new LiveChatClient().getBaseUrl()).toBe('');

    (globalThis as any).window = { location: { hostname: '127.0.0.1' } };
    expect(new LiveChatClient().getBaseUrl()).toBe('');

    (globalThis as any).window = { location: { hostname: 'web-chess-app.netlify.app' } };
    expect(new LiveChatClient().getBaseUrl()).toBe(POCKETHOST_URL);

    (globalThis as any).window = undefined;
    expect(new LiveChatClient().getBaseUrl()).toBe(POCKETHOST_URL);
  });

  it('resolves isLocalMode across pockethost, window-less, and hostname branches', () => {
    expect(new LiveChatClient({ baseUrl: POCKETHOST_URL }).isLocalMode()).toBe(false);

    (globalThis as any).window = undefined;
    expect(new LiveChatClient({ baseUrl: 'https://example.com' }).isLocalMode()).toBe(true);

    (globalThis as any).window = {};
    expect(new LiveChatClient({ baseUrl: 'https://example.com' }).isLocalMode()).toBe(true);

    (globalThis as any).window = { location: {} };
    expect(new LiveChatClient({ baseUrl: 'https://example.com' }).isLocalMode()).toBe(true);

    (globalThis as any).window = { location: { hostname: 'localhost' } };
    expect(new LiveChatClient({ baseUrl: 'https://example.com' }).isLocalMode()).toBe(true);

    (globalThis as any).window = { location: { hostname: 'web-chess.netlify.app' } };
    expect(new LiveChatClient({ baseUrl: 'https://example.com' }).isLocalMode()).toBe(false);
  });

  it('fetchHistory fails cleanly when no session code is set', async () => {
    const client = new LiveChatClient();
    const res = await client.fetchHistory();
    expect(res.match({ Ok: () => false, Err: () => true })).toBe(true);
  });

  it('fetchHistory (local mode) sorts merged messages, dedupes repeats, and skips invalid items', async () => {
    const client = new LiveChatClient({ baseUrl: 'http://localhost:3000', sessionCode: 'SANCT-HIST' });
    const items = [
      { id: 'm3', txt_session_code: 'SANCT-HIST', txt_sender_id: 'u', txt_sender_name: 'U', txt_sender_role: 'white', txt_message: 'third', int_created_at: 300 },
      { id: 'm1', txt_session_code: 'SANCT-HIST', txt_sender_id: 'u', txt_sender_name: 'U', txt_sender_role: 'white', txt_message: 'first', int_created_at: 100 },
      { id: '' }
    ];
    responder = () => new Response(JSON.stringify({ messages: items }), { status: 200 });
    const res = await client.fetchHistory();
    expect(res.match({ Ok: () => true, Err: () => false })).toBe(true);
    expect(client.getMessages().map(m => m.id)).toEqual(['m1', 'm3']);

    // Second call with the same payload is fully deduped
    const res2 = await client.fetchHistory();
    expect(res2.getOrElse([]).length).toBe(2);

    // A 200 response with an unparseable body is treated as an empty history page
    responder = () => new Response('{not valid json', { status: 200 });
    const malformedRes = await client.fetchHistory();
    expect(malformedRes.match({ Ok: () => true, Err: () => false })).toBe(true);

    // A thrown fetch surfaces as a network failure
    globalThis.fetch = mock(async () => {
      throw new Error('local offline');
    }) as any;
    const throwRes = await client.fetchHistory();
    expect(throwRes.match({ Ok: () => false, Err: () => true })).toBe(true);
  });

  it('fetchHistory (PocketBase mode) sorts, dedupes, skips invalid items, and reports HTTP/network failures', async () => {
    const client = new LiveChatClient({ baseUrl: POCKETHOST_URL, sessionCode: 'SANCT-PBHIST', authToken: 'tok_h' });
    const pbItems = [
      { id: 'p2', txt_session_code: 'SANCT-PBHIST', txt_sender_id: 'u', txt_sender_name: 'U', txt_sender_role: 'white', txt_message: 'second', int_created_at: 200 },
      { id: 'p1', txt_session_code: 'SANCT-PBHIST', txt_sender_id: 'u', txt_sender_name: 'U', txt_sender_role: 'white', txt_message: 'first', int_created_at: 100 },
      { id: '' }
    ];
    responder = () => new Response(JSON.stringify({ items: pbItems }), { status: 200 });
    const res = await client.fetchHistory();
    expect(res.match({ Ok: () => true, Err: () => false })).toBe(true);
    expect(client.getMessages().map(m => m.id)).toEqual(['p1', 'p2']);
    const historyCall = calls.find(c => c.url.includes(CHAT_COLLECTION))!;
    expect(historyCall.init?.headers?.Authorization).toBe('tok_h');

    // A 200 response with an unparseable body is treated as an empty history page
    responder = () => new Response('{not valid json', { status: 200 });
    const malformedRes = await client.fetchHistory();
    expect(malformedRes.match({ Ok: () => true, Err: () => false })).toBe(true);

    responder = () => new Response('Forbidden', { status: 403 });
    const failRes = await client.fetchHistory();
    expect(failRes.match({ Ok: () => false, Err: () => true })).toBe(true);

    globalThis.fetch = mock(async () => {
      throw new Error('offline');
    }) as any;
    const throwRes = await client.fetchHistory();
    expect(throwRes.match({ Ok: () => false, Err: () => true })).toBe(true);
  });

  it('sendMessage surfaces schema validation failures from client state', async () => {
    const client = new LiveChatClient({ baseUrl: 'http://localhost:3000', sessionCode: 'SANCT-VALID' });
    (client as any).senderName = 'x'.repeat(100);
    const res = await client.sendMessage('Hello');
    expect(res.match({ Ok: () => false, Err: () => true })).toBe(true);
    expect(res.match({ Ok: () => '', Err: e => e.message })).toContain('senderName');
  });

  it('sendMessage (local mode) falls back to a constructed record when the server omits one, and reports thrown network errors', async () => {
    const client = new LiveChatClient({ baseUrl: 'http://localhost:3000', sessionCode: 'SANCT-FALLBACK', senderName: 'Tester', senderRole: 'white' });

    // A 200 response with an unparseable body still falls back to a constructed record
    responder = () => new Response('{not valid json', { status: 200 });
    const res = await client.sendMessage('Fallback please');
    expect(res.match({ Ok: () => true, Err: () => false })).toBe(true);
    expect(res.getOrElse(null as any).txt_message).toBe('Fallback please');
    expect(client.getMessages().length).toBe(1);

    // A failure response whose body was already consumed still reports an HTTP failure
    const consumed = new Response('server exploded', { status: 500, statusText: 'Internal Error' });
    await consumed.text();
    responder = () => consumed;
    const httpFailRes = await client.sendMessage('Will 500');
    expect(httpFailRes.match({ Ok: () => false, Err: () => true })).toBe(true);

    globalThis.fetch = mock(async () => {
      throw new Error('socket reset');
    }) as any;
    const failRes = await client.sendMessage('Will explode');
    expect(failRes.match({ Ok: () => false, Err: () => true })).toBe(true);
  });

  it('sendMessage (PocketBase mode) includes the session relation, falls back on unparseable records, reports HTTP failures, and thrown errors', async () => {
    const client = new LiveChatClient({ baseUrl: POCKETHOST_URL, sessionCode: 'SANCT-PBSEND', sessionId: 'sid_9', authToken: 'tok_z' });

    responder = () => new Response('{"id":"only-id"}', { status: 200 });
    const res = await client.sendMessage('PB fallback');
    expect(res.match({ Ok: () => true, Err: () => false })).toBe(true);
    const create = calls.find(c => c.url === `${POCKETHOST_URL}/api/collections/${CHAT_COLLECTION}/records`)!;
    const body = JSON.parse(create.init.body);
    expect(body.session).toBe('sid_9');
    expect(create.init.headers['Authorization']).toBe('tok_z');

    // A 200 response with an unparseable body also falls back to a constructed record
    responder = () => new Response('{not valid json', { status: 200 });
    const malformedRes = await client.sendMessage('PB malformed body');
    expect(malformedRes.match({ Ok: () => true, Err: () => false })).toBe(true);

    // A failure response whose body was already consumed still reports an HTTP failure
    const consumed = new Response('forbidden', { status: 403, statusText: 'Forbidden' });
    await consumed.text();
    responder = () => consumed;
    const httpFailRes = await client.sendMessage('nope');
    expect(httpFailRes.match({ Ok: () => false, Err: () => true })).toBe(true);

    globalThis.fetch = mock(async () => {
      throw new Error('dns fail');
    }) as any;
    const throwRes = await client.sendMessage('explode');
    expect(throwRes.match({ Ok: () => false, Err: () => true })).toBe(true);
  });

  it('setSession disconnects prior state, applies identity, fetches history, and opens a new SSE stream', async () => {
    const client = new LiveChatClient({ baseUrl: 'http://localhost:3000', sessionCode: 'OLD', senderId: 'uid_0' });
    client.connectSSE();
    const oldEs = MockEventSource.last!;
    oldEs.emit('open');
    expect(client.getIsConnected()).toBe(true);

    responder = url =>
      url.includes('/api/chat/messages/NEW') ? new Response(JSON.stringify({ messages: [] }), { status: 200 }) : new Response('{}', { status: 200 });

    await client.setSession('NEW', 'Bob', 'black', 'uid_1', 'sid_1', 'tok_1');

    expect(oldEs.closed).toBe(true);
    expect(client.getSessionCode().getOrElse('')).toBe('NEW');
    expect(client.getSenderName()).toBe('Bob');
    expect(client.getSenderRole()).toBe('black');
    expect(client.getSenderId()).toBe('uid_1');
    expect(calls.some(c => c.url.includes('/api/chat/messages/NEW'))).toBe(true);
    const newEs = MockEventSource.last!;
    expect(newEs).not.toBe(oldEs);
    expect(newEs.url).toBe('http://localhost:3000/api/sessions/sid_1/events');
  });

  it('setSession falls back to default identity and keeps the prior sender id when new values are omitted', async () => {
    const client = new LiveChatClient({ baseUrl: 'http://localhost:3000', senderId: 'uid_keep' });
    await client.setSession('NEW2', '', '', undefined, undefined, undefined);

    expect(client.getSenderName()).toBe('Sanctuary Player');
    expect(client.getSenderRole()).toBe('player');
    expect(client.getSenderId()).toBe('uid_keep');
    const es = MockEventSource.last!;
    expect(es.url).toBe(`http://localhost:3000/api/arcade/sessions/NEW2/events?participantId=${encodeURIComponent('uid_keep')}`);
  });

  it('connectSSE no-ops when EventSource is unavailable', () => {
    (globalThis as any).EventSource = undefined;
    const client = new LiveChatClient({ baseUrl: 'http://localhost:3000', sessionCode: 'NOEVT' });
    expect(() => client.connectSSE()).not.toThrow();
    expect(client.getIsConnected()).toBe(false);
  });

  it('connectSSE (local mode) delivers valid chat events and ignores malformed ones', () => {
    const client = new LiveChatClient({ baseUrl: 'http://localhost:3000', sessionCode: 'SANCT-SSE' });
    client.connectSSE();
    const es = MockEventSource.last!;
    expect(es.url).toBe(`http://localhost:3000/api/arcade/sessions/SANCT-SSE/events?participantId=${encodeURIComponent(client.getSenderId())}`);

    es.emit('open');
    expect(client.getIsConnected()).toBe(true);

    const msg: ChatMessageRecordData = {
      id: 'sse-1',
      txt_session_code: 'SANCT-SSE',
      txt_sender_id: 'peer',
      txt_sender_name: 'Peer',
      txt_sender_role: 'black',
      txt_message: 'Hi there',
      int_created_at: 10
    };
    es.emit('chat_message', { data: JSON.stringify(msg) });
    expect(client.getMessages().length).toBe(1);

    es.emit('chat_message', { data: 'not json' });
    expect(client.getMessages().length).toBe(1);

    es.emit('error');
    expect(client.getIsConnected()).toBe(false);

    client.disconnectSSE();
    expect(es.closed).toBe(true);
  });

  it('connectSSE (PocketBase mode) subscribes on PB_CONNECT and routes topic/collection events', async () => {
    const client = new LiveChatClient({ baseUrl: POCKETHOST_URL, sessionCode: 'SANCT-PBSSE', authToken: 'tok_x' });
    client.connectSSE();
    const es = MockEventSource.last!;
    expect(es.url).toBe(`${POCKETHOST_URL}/api/realtime`);

    es.emit('open');
    expect(client.getIsConnected()).toBe(true);

    es.emit('PB_CONNECT', { data: JSON.stringify({ clientId: 'c1' }) });
    await flush();
    const sub = calls.find(c => c.url === `${POCKETHOST_URL}/api/realtime` && c.init?.method === 'POST')!;
    expect(sub).toBeTruthy();
    const subBody = JSON.parse(sub.init.body);
    expect(subBody.clientId).toBe('c1');
    expect(subBody.subscriptions).toEqual([chatMessagesTopic('SANCT-PBSSE'), CHAT_COLLECTION, `${CHAT_COLLECTION}/*`]);
    expect(sub.init.headers['Authorization']).toBe('tok_x');

    const callsBefore = calls.length;
    es.emit('PB_CONNECT', { data: JSON.stringify({}) });
    await flush();
    expect(calls.length).toBe(callsBefore);

    es.emit('PB_CONNECT', { data: 'not json' });
    await flush();
    expect(calls.length).toBe(callsBefore);

    const topic = chatMessagesTopic('SANCT-PBSSE');
    const record = (over: Record<string, unknown> = {}) => ({
      id: 'r1',
      txt_session_code: 'SANCT-PBSSE',
      txt_sender_id: 'peer',
      txt_sender_name: 'Peer',
      txt_sender_role: 'black',
      txt_message: 'yo',
      int_created_at: 1,
      ...over
    });

    es.emit(topic, { data: JSON.stringify({ action: 'create', record: record() }) });
    expect(client.getMessages().length).toBe(1);

    es.emit(CHAT_COLLECTION, { data: JSON.stringify({ action: 'create', record: record({ id: 'r2', txt_session_code: 'OTHER' }) }) });
    expect(client.getMessages().length).toBe(1);

    es.emit(topic, { data: JSON.stringify({ action: 'update', record: record({ id: 'r3' }) }) });
    expect(client.getMessages().length).toBe(1);

    es.emit(topic, { data: JSON.stringify({ action: 'create' }) });
    expect(client.getMessages().length).toBe(1);

    es.emit(topic, { data: 'garbage' });
    expect(client.getMessages().length).toBe(1);

    es.emit('error');
    expect(client.getIsConnected()).toBe(false);
  });
});
