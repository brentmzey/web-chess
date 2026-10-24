import { fromNullable, matchBool } from '../../utils/fp';
import { logger } from '../../utils/logger';
import { currentEpochMs } from '../../utils/dateTime';
import type { SessionRepository } from '../db/sessionRepository';
import type { SSEEnvelope, SessionEventRecord } from './sseTypes';

export interface SSEConnection {
  participantId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  connectedAt: number;
}

/**
 * Manages Server-Sent Events (SSE) connections, heartbeats, broadcast fan-out,
 * and reliable message catch-up replay via Last-Event-ID.
 */
export class SSEManager {
  private sessions: Map<string, Map<string, SSEConnection>> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private encoder: TextEncoder = new TextEncoder();

  constructor(private repository: SessionRepository) {}

  /**
   * Encodes an SSE data frame adhering strictly to the W3C EventSource standard.
   */
  public formatSSE(envelope: SSEEnvelope): Uint8Array {
    const raw = `id: ${envelope.id}\nevent: ${envelope.event}\ndata: ${JSON.stringify(envelope.data)}\n\n`;
    return this.encoder.encode(raw);
  }

  /**
   * Encodes a comment line for keep-alive pings (ignored by EventSource listeners).
   */
  public formatKeepAlive(): Uint8Array {
    return this.encoder.encode(':keepalive\n\n');
  }

  /**
   * Subscribes an HTTP SSE stream controller to a session room.
   * If `lastEventId` is provided, replays all missed events from the database first.
   */
  public subscribe(
    sessionId: string,
    participantId: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
    lastEventId?: number
  ): void {
    let room = this.sessions.get(sessionId);
    if (!room) {
      room = new Map();
      this.sessions.set(sessionId, room);
    }

    const connection: SSEConnection = {
      participantId,
      controller,
      connectedAt: currentEpochMs()
    };
    room.set(participantId, connection);

    // Initial keepalive to establish connection immediately
    try {
      controller.enqueue(this.formatKeepAlive());
    } catch {
      room.delete(participantId);
      return;
    }

    // Replay past events if client provided a valid Last-Event-ID
    fromNullable(lastEventId).map(lastId => {
      matchBool(lastId >= 0, {
        true: () => {
          const missedEvents = this.repository.getEventsSince(sessionId, lastId);
          missedEvents.forEach(evt => {
            this.sendEventToConnection(connection, evt);
          });
        },
        false: () => {}
      });
    });

    logger.info(`[SSE] Client ${participantId} subscribed to session ${sessionId}. Active listeners: ${room.size}`);
  }

  /**
   * Removes a connection from a session room.
   */
  public unsubscribe(sessionId: string, participantId: string): void {
    const room = this.sessions.get(sessionId);
    fromNullable(room).map(r => {
      r.delete(participantId);
      if (r.size === 0) {
        this.sessions.delete(sessionId);
      }
    });
  }

  /**
   * Broadcasts a recorded event to all connected listeners in the session room.
   */
  public broadcast(sessionId: string, eventRecord: SessionEventRecord): void {
    const room = this.sessions.get(sessionId);
    if (!room) return;

    const deadConnections: string[] = [];

    room.forEach((conn, participantId) => {
      const delivered = this.sendEventToConnection(conn, eventRecord);
      matchBool(delivered, {
        true: () => {},
        false: () => deadConnections.push(participantId)
      });
    });

    deadConnections.forEach(id => room.delete(id));
  }

  private sendEventToConnection(conn: SSEConnection, eventRecord: SessionEventRecord): boolean {
    try {
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(eventRecord.payload_json);
      } catch {
        parsedPayload = eventRecord.payload_json;
      }

      const envelope: SSEEnvelope = {
        id: eventRecord.event_seq,
        event: eventRecord.event_type,
        data: parsedPayload,
        timestamp: eventRecord.created_at
      };

      conn.controller.enqueue(this.formatSSE(envelope));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Executes a single heartbeat cycle across all active sessions and connections.
   */
  public sendHeartbeatTick(): void {
    const ping = this.formatKeepAlive();
    this.sessions.forEach((room, sessionId) => {
      const deadConnections: string[] = [];
      room.forEach((conn, participantId) => {
        try {
          conn.controller.enqueue(ping);
        } catch {
          deadConnections.push(participantId);
        }
      });
      deadConnections.forEach(id => room.delete(id));
      if (room.size === 0) {
        this.sessions.delete(sessionId);
      }
    });
  }

  /**
   * Starts periodic heartbeat timer (:keepalive\n\n) to prevent HTTP timeouts.
   */
  public startHeartbeat(intervalMs: number = 15000): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeatTick();
    }, intervalMs);
  }

  /**
   * Stops the periodic heartbeat timer.
   */
  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public getSubscriberCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.size ?? 0;
  }
}
