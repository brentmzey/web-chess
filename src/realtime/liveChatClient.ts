import {
  failure,
  fromNullable,
  matchBool,
  none,
  some,
  success,
  tryCatch,
  tryCatchAsync,
  type Option,
  type Result
} from '../utils/fp';
import { currentEpochMs } from '../utils/dateTime';
import { generateUuidV4 } from '../utils/uuid';
import { NetworkError, ValidationError, type SanctuaryError } from '../errors/sanctuaryError';
import {
  ChatMessageRecordSchema,
  parseChatMessageInput,
  type ChatMessageRecordData
} from '../validation/chatSchemas';

export const POCKETHOST_URL = 'https://web-chess.pockethost.io';
export const CHAT_COLLECTION = 'tbl_chat_messages';

const stripChatMessageHtml = (text: string): string =>
  text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>?/gm, '')
    .trim();

export const sanitizeChatMessage = (text: string,
                                    maxLen: number = 500): string =>
  stripChatMessageHtml(text).slice(0, maxLen);

export const chatMessagesTopic = (sessionCode: string): string =>
  `${CHAT_COLLECTION}?options=${encodeURIComponent(JSON.stringify({ query: { filter: `txt_session_code="${sessionCode}"` } }))}`;

export type ChatMessageHandler = (message: ChatMessageRecordData) => void;

export interface LiveChatConfig {
  readonly baseUrl?: string;
  readonly sessionCode?: string;
  readonly senderName?: string;
  readonly senderRole?: string;
  readonly senderId?: string;
  readonly sessionId?: string;
  readonly authToken?: string;
}

export class LiveChatClient {
  private baseUrl: string;
  private sessionCode: Option<string> = none();
  private senderName: string = 'Sanctuary Player';
  private senderRole: string = 'player';
  private senderId: string;
  private sessionId: Option<string> = none();
  private authToken: Option<string> = none();
  private eventSource: Option<EventSource> = none();
  private messages: ChatMessageRecordData[] = [];
  private seenMessageIds: Set<string> = new Set();
  private messageListeners: Set<ChatMessageHandler> = new Set();
  private unreadCount: number = 0;
  private isConnected: boolean = false;

  constructor(config: LiveChatConfig = {}) {
    this.baseUrl = (config.baseUrl ?? LiveChatClient.resolveDefaultBaseUrl()).replace(/\/+$/, '');
    this.senderId = config.senderId || `user_${generateUuidV4().slice(0, 8)}`;
    if (config.senderName) this.senderName = config.senderName;
    if (config.senderRole) this.senderRole = config.senderRole;
    if (config.sessionCode) this.sessionCode = some(config.sessionCode);
    if (config.sessionId) this.sessionId = some(config.sessionId);
    if (config.authToken) this.authToken = some(config.authToken);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private static resolveDefaultBaseUrl(): string {
    return typeof window !== 'undefined' && window.location
      ? matchBool(['localhost', '127.0.0.1'].includes(window.location.hostname), {
          true: () => '',
          false: () => POCKETHOST_URL
        })
      : POCKETHOST_URL;
  }

  public getSessionCode(): Option<string> {
    return this.sessionCode;
  }

  public getSenderName(): string {
    return this.senderName;
  }

  public getSenderRole(): string {
    return this.senderRole;
  }

  public getSenderId(): string {
    return this.senderId;
  }

  public getMessages(): ReadonlyArray<ChatMessageRecordData> {
    return [...this.messages];
  }

  public getUnreadCount(): number {
    return this.unreadCount;
  }

  public resetUnreadCount(): void {
    this.unreadCount = 0;
  }

  public incrementUnreadCount(): void {
    this.unreadCount += 1;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public onMessage(handler: ChatMessageHandler): () => void {
    this.messageListeners.add(handler);
    return () => {
      this.messageListeners.delete(handler);
    };
  }

  public isLocalMode(): boolean {
    if (this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1')) {
      return true;
    }
    if (this.baseUrl.includes('pockethost.io')) {
      return false;
    }
    if (typeof window === 'undefined' || !window.location || !window.location.hostname) {
      return true;
    }
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  public async setSession(sessionCode: string,
                          senderName: string,
                          senderRole: string,
                          senderId?: string,
                          sessionId?: string,
                          authToken?: string): Promise<void> {
    this.disconnect();
    this.sessionCode = some(sessionCode);
    this.senderName = senderName || 'Sanctuary Player';
    this.senderRole = senderRole || 'player';
    if (senderId) this.senderId = senderId;
    this.sessionId = fromNullable(sessionId);
    this.authToken = fromNullable(authToken);
    this.messages = [];
    this.seenMessageIds.clear();
    this.unreadCount = 0;

    await this.fetchHistory();
    this.connectSSE();
  }

  public async fetchHistory(limit: number = 50): Promise<Result<ReadonlyArray<ChatMessageRecordData>, SanctuaryError>> {
    return this.sessionCode.match({
      None: async () => failure(new ValidationError('SESSION_REQUIRED', 'Cannot fetch chat history without an active session code')),
      Some: async (code) => {
        return matchBool(this.isLocalMode(), {
          true: async () => {
            const url = `${this.baseUrl}/api/chat/messages/${encodeURIComponent(code)}?limit=${limit}`;
            const res = await tryCatchAsync(async () => fetch(url), err => new NetworkError(String(err)));
            return res.flatMapAsync(async resp => {
              if (!resp.ok) {
                return failure(new NetworkError(`Failed to fetch chat history: HTTP ${resp.status}`));
              }
              const data = (await resp.json().catch(() => ({}))) as { messages?: unknown[] };
              const fetched: ChatMessageRecordData[] = [];
              for (const item of data.messages || []) {
                const parsed = ChatMessageRecordSchema.safeParse(item);
                if (parsed.success && !this.seenMessageIds.has(parsed.data.id)) {
                  this.seenMessageIds.add(parsed.data.id);
                  fetched.push(parsed.data);
                }
              }
              this.messages = [...this.messages, ...fetched].sort((a, b) =>
                (a.int_created_at || 0) - (b.int_created_at || 0)
              );
              return success(this.messages as ReadonlyArray<ChatMessageRecordData>);
            });
          },
          false: async () => {
            const filter = encodeURIComponent(`txt_session_code='${code}'`);
            const url = `${this.baseUrl}/api/collections/${CHAT_COLLECTION}/records?filter=(${filter})&sort=created&perPage=${limit}`;
            const headers: Record<string, string> = {};
            this.authToken.map(t => {
              headers['Authorization'] = t;
            });

            const res = await tryCatchAsync(async () => fetch(url, { headers }), err => new NetworkError(String(err)));
            return res.flatMapAsync(async resp => {
              if (!resp.ok) {
                return failure(new NetworkError(`Failed to fetch PocketBase chat history: HTTP ${resp.status}`));
              }
              const data = (await resp.json().catch(() => ({}))) as { items?: unknown[] };
              const fetched: ChatMessageRecordData[] = [];
              for (const item of data.items || []) {
                const parsed = ChatMessageRecordSchema.safeParse(item);
                if (parsed.success && !this.seenMessageIds.has(parsed.data.id)) {
                  this.seenMessageIds.add(parsed.data.id);
                  fetched.push(parsed.data);
                }
              }
              this.messages = [...this.messages, ...fetched].sort((a, b) =>
                (a.int_created_at || 0) - (b.int_created_at || 0)
              );
              return success(this.messages as ReadonlyArray<ChatMessageRecordData>);
            });
          }
        });
      }
    });
  }

  public async sendMessage(rawText: string): Promise<Result<ChatMessageRecordData, SanctuaryError>> {
    const clean = stripChatMessageHtml(rawText).slice(0, 500);
    if (!clean) {
      return failure(new ValidationError('MESSAGE_EMPTY', 'Chat message cannot be empty'));
    }

    return this.sessionCode.match({
      None: async () => failure(new ValidationError('SESSION_REQUIRED', 'Cannot send chat message without an active session code')),
      Some: async (code) => {
        const payload = {
          sessionCode: code,
          senderId: this.senderId,
          senderName: this.senderName,
          senderRole: this.senderRole,
          message: clean
        };

        const validated = parseChatMessageInput(payload);
        return validated.match<Promise<Result<ChatMessageRecordData, SanctuaryError>>>({
          Err: async err => failure(err),
          Ok: async () => {
            const now = currentEpochMs();

            return matchBool(this.isLocalMode(), {
              true: async () => {
                const body = {
                  sessionId: this.sessionId.getOrElse(''),
                  sessionCode: code,
                  senderId: this.senderId,
                  senderName: this.senderName,
                  senderRole: this.senderRole,
                  message: clean,
                  createdAt: now
                };
                const res = await tryCatchAsync(
                  async () =>
                    fetch(`${this.baseUrl}/api/chat/messages`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(body)
                    }),
                  err => new NetworkError(String(err))
                );

                return res.flatMapAsync(async resp => {
                  if (!resp.ok) {
                    const errText = await resp.text().catch(() => '');
                    return failure(new NetworkError(`Failed to send message: ${errText || resp.statusText}`));
                  }
                  const json = (await resp.json().catch(() => ({}))) as { message?: ChatMessageRecordData };
                  const msg = json.message || {
                    id: generateUuidV4(),
                    txt_session_code: code,
                    txt_sender_id: this.senderId,
                    txt_sender_name: this.senderName,
                    txt_sender_role: this.senderRole,
                    txt_message: clean,
                    int_created_at: now
                  };
                  this.handleIncomingMessage(msg);
                  return success(msg);
                });
              },
              false: async () => {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                this.authToken.map(t => {
                  headers['Authorization'] = t;
                });
                const pbBody: Record<string, unknown> = {
                  txt_session_code: code,
                  txt_sender_id: this.senderId,
                  txt_sender_name: this.senderName,
                  txt_sender_role: this.senderRole,
                  txt_message: clean,
                  int_created_at: now
                };
                this.sessionId.map(sid => {
                  pbBody['session'] = sid;
                });

                const res = await tryCatchAsync(
                  async () =>
                    fetch(`${this.baseUrl}/api/collections/${CHAT_COLLECTION}/records`, {
                      method: 'POST',
                      headers,
                      body: JSON.stringify(pbBody)
                    }),
                  err => new NetworkError(String(err))
                );

                return res.flatMapAsync(async resp => {
                  if (!resp.ok) {
                    const errText = await resp.text().catch(() => '');
                    return failure(new NetworkError(`Failed to post PocketBase chat message: ${errText || resp.statusText}`));
                  }
                  const rawRecord = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
                  const parsed = ChatMessageRecordSchema.safeParse(rawRecord);
                  const msg: ChatMessageRecordData = parsed.success
                    ? parsed.data
                    : {
                        id: String(rawRecord.id || generateUuidV4()),
                        txt_session_code: code,
                        txt_sender_id: this.senderId,
                        txt_sender_name: this.senderName,
                        txt_sender_role: this.senderRole,
                        txt_message: clean,
                        int_created_at: now
                      };
                  this.handleIncomingMessage(msg);
                  return success(msg);
                });
              }
            });
          }
        });
      }
    });
  }

  public handleIncomingMessage(msg: ChatMessageRecordData): void {
    if (this.seenMessageIds.has(msg.id)) return;
    this.seenMessageIds.add(msg.id);
    this.messages.push(msg);
    this.messageListeners.forEach(fn => {
      tryCatch(() => fn(msg));
    });
  }

  public connectSSE(): void {
    this.sessionCode.map(code => {
      if (typeof EventSource === 'undefined') return;
      this.disconnectSSE();

      if (this.isLocalMode()) {
        const sseUrl = this.sessionId.match({
          Some: sid => `${this.baseUrl}/api/sessions/${sid}/events`,
          None: () => `${this.baseUrl}/api/arcade/sessions/${code}/events?participantId=${encodeURIComponent(this.senderId)}`
        });

        const es = new EventSource(sseUrl);
        this.eventSource = some(es);

        es.addEventListener('open', () => {
          this.isConnected = true;
        });

        es.addEventListener('chat_message', (evt: MessageEvent) => {
          const raw = tryCatch(() => JSON.parse(evt.data) as unknown).getOrElse(null);
          const parsed = ChatMessageRecordSchema.safeParse(raw);
          if (parsed.success) {
            this.handleIncomingMessage(parsed.data);
          }
        });

        es.addEventListener('error', () => {
          this.isConnected = false;
        });
      } else {
        const sseUrl = `${this.baseUrl}/api/realtime`;
        const es = new EventSource(sseUrl);
        this.eventSource = some(es);

        es.addEventListener('open', () => {
          this.isConnected = true;
        });

        es.addEventListener('PB_CONNECT', async (e: any) => {
          const data = tryCatch(() => JSON.parse(e.data) as { clientId: string }).getOrElse({ clientId: '' });

          if (data.clientId) {
            const topic = chatMessagesTopic(code);
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            this.authToken.map(t => {
              headers['Authorization'] = t;
            });
            await tryCatchAsync(async () =>
              fetch(`${this.baseUrl}/api/realtime`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  clientId: data.clientId,
                  subscriptions: [topic, CHAT_COLLECTION, `${CHAT_COLLECTION}/*`]
                })
              })
            );
          }
        });

        const handlePbChatMessage = (e: any) => {
          const payload = tryCatch(() => JSON.parse(e.data) as { action: string; record: Record<string, unknown> }).match({
            Ok: val => val,
            Err: () => null
          });
          if (payload && payload.action === 'create' && payload.record) {
            const parsed = ChatMessageRecordSchema.safeParse(payload.record);
            if (parsed.success && parsed.data.txt_session_code === code) {
              this.handleIncomingMessage(parsed.data);
            }
          }
        };

        const topic = chatMessagesTopic(code);
        es.addEventListener(topic, handlePbChatMessage);
        es.addEventListener(CHAT_COLLECTION, handlePbChatMessage);

        es.addEventListener('error', () => {
          this.isConnected = false;
        });
      }
    });
  }

  public disconnectSSE(): void {
    this.eventSource.map(es => {
      es.close();
    });
    this.eventSource = none();
    this.isConnected = false;
  }

  public disconnect(): void {
    this.disconnectSSE();
    this.sessionCode = none();
    this.sessionId = none();
    this.authToken = none();
    this.messages = [];
    this.seenMessageIds.clear();
    this.unreadCount = 0;
  }
}
