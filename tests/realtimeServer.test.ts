import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SanctuaryRealtimeServer } from '../src/server/server';

describe('SanctuaryRealtimeServer HTTP & SSE Endpoints', () => {
  let server: SanctuaryRealtimeServer;

  beforeEach(() => {
    server = new SanctuaryRealtimeServer({ port: 3888, dbPath: ':memory:' });
  });

  afterEach(() => {
    server.stop();
  });

  it('handles OPTIONS preflight requests with CORS headers', async () => {
    const req = new Request('http://localhost:3888/api/sessions', { method: 'OPTIONS' });
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(204);
    expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('creates sessions via POST /api/sessions', async () => {
    const req = new Request('http://localhost:3888/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'emerald-citadel',
        creatorDisplayName: 'Endpoint Tester',
        creatorRole: 'white'
      })
    });

    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as any;
    expect(body.session.theme).toBe('emerald-citadel');
    expect(body.participant.display_name).toBe('Endpoint Tester');
    expect(body.token.length).toBe(64);
  });

  it('joins sessions via POST /api/sessions/join', async () => {
    // 1. Create host session
    const hostRes = server.service.createSession({ creatorRole: 'white' }).getOrThrow();

    // 2. Missing fields error
    const badReq = new Request('http://localhost:3888/api/sessions/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const badResp = await server.handleRequest(badReq);
    expect(badResp.status).toBe(400);

    // 3. Valid join
    const req = new Request('http://localhost:3888/api/sessions/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionCode: hostRes.session.session_code,
        displayName: 'Black Contender'
      })
    });
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as any;
    expect(body.participant.role).toBe('black');
  });

  it('fetches session state via GET /api/sessions/:id', async () => {
    const hostRes = server.service.createSession({ creatorRole: 'white' }).getOrThrow();

    const req = new Request(`http://localhost:3888/api/sessions/${hostRes.session.id}`);
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as any;
    expect(body.session.id).toBe(hostRes.session.id);
    expect(Array.isArray(body.moves)).toBe(true);

    // 404 for non-existent session
    const notFoundReq = new Request('http://localhost:3888/api/sessions/unknown-id');
    const notFoundResp = await server.handleRequest(notFoundReq);
    expect(notFoundResp.status).toBe(404);
  });

  it('serves Server-Sent Events stream via GET /api/sessions/:id/events and handles cancellation', async () => {
    const hostRes = server.service.createSession({ creatorRole: 'white' }).getOrThrow();

    const req = new Request(
      `http://localhost:3888/api/sessions/${hostRes.session.id}/events?participantId=p-test&lastEventId=0`
    );
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('text/event-stream');
    expect(resp.headers.get('Cache-Control')).toBe('no-cache, no-transform');

    // Cancel stream to trigger cancel() and cleanup()
    await resp.body?.cancel();

    // 404 on non-existent session
    const notFoundReq = new Request('http://localhost:3888/api/sessions/unknown-id/events');
    const notFoundResp = await server.handleRequest(notFoundReq);
    expect(notFoundResp.status).toBe(404);
  });

  it('submits moves via POST /api/sessions/:id/moves', async () => {
    const hostRes = server.service.createSession({ creatorRole: 'white' }).getOrThrow();

    // 1. Missing sanOrUci
    const badReq = new Request(`http://localhost:3888/api/sessions/${hostRes.session.id}/moves`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostRes.token}`
      },
      body: JSON.stringify({})
    });
    const badResp = await server.handleRequest(badReq);
    expect(badResp.status).toBe(400);

    // 2. Valid move 1. e4
    const req = new Request(`http://localhost:3888/api/sessions/${hostRes.session.id}/moves`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostRes.token}`
      },
      body: JSON.stringify({ sanOrUci: 'e4' })
    });
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as any;
    expect(body.move.san).toBe('e4');
  });

  it('resigns and changes themes via POST endpoints', async () => {
    const hostRes = server.service.createSession({ creatorRole: 'white' }).getOrThrow();

    // Theme change
    const themeReq = new Request(`http://localhost:3888/api/sessions/${hostRes.session.id}/theme`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostRes.token}`
      },
      body: JSON.stringify({ theme: 'astral-observatory' })
    });
    const themeResp = await server.handleRequest(themeReq);
    expect(themeResp.status).toBe(200);
    expect(((await themeResp.json()) as any).session.theme).toBe('astral-observatory');

    // Resign
    const resignReq = new Request(
      `http://localhost:3888/api/sessions/${hostRes.session.id}/resign`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${hostRes.token}` }
      }
    );
    const resignResp = await server.handleRequest(resignReq);
    expect(resignResp.status).toBe(200);
    expect(((await resignResp.json()) as any).session.status).toBe('resigned');
  });

  it('handles invalid JSON bodies, query tokens, and missing theme parameters gracefully', async () => {
    const hostRes = server.service.createSession({ creatorRole: 'white' }).getOrThrow();

    // 1. Invalid JSON body in POST /api/sessions -> falls back to empty object
    const brokenJsonReq = new Request('http://localhost:3888/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-non-json{{{'
    });
    const brokenResp = await server.handleRequest(brokenJsonReq);
    expect(brokenResp.status).toBe(201); // created with defaults

    // 2. Token in query param instead of Bearer header
    const queryTokenReq = new Request(
      `http://localhost:3888/api/sessions/${hostRes.session.id}/moves?token=${hostRes.token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sanOrUci: 'e4' })
      }
    );
    const queryTokenResp = await server.handleRequest(queryTokenReq);
    expect(queryTokenResp.status).toBe(200);

    // 3. Missing theme parameter
    const badThemeReq = new Request(
      `http://localhost:3888/api/sessions/${hostRes.session.id}/theme`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostRes.token}`
        },
        body: JSON.stringify({})
      }
    );
    const badThemeResp = await server.handleRequest(badThemeReq);
    expect(badThemeResp.status).toBe(400);

    // 4. Unknown route
    const unknownReq = new Request('http://localhost:3888/api/nonexistent');
    const unknownResp = await server.handleRequest(unknownReq);
    expect(unknownResp.status).toBe(404);
  });

  it('starts and stops Bun.serve HTTP server listening instance', async () => {
    const running = server.start();
    expect(running).toBeDefined();
    expect(typeof running.port).toBe('number');

    // Subsequent start returns same instance
    expect(server.start()).toBe(running);

    const res = await fetch(`http://localhost:${running.port}/api/nonexistent`);
    expect(res.status).toBe(404);

    server.stop();
  });
});
