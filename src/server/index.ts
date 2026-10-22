import { SanctuaryRealtimeServer } from './server';
import { logger } from '../utils/logger';

const port = parseInt(process.env.PORT || '3001', 10);
const dbPath = process.env.DB_PATH || 'sanctuary_chess.db';

const server = new SanctuaryRealtimeServer({ port, dbPath });
server.start();

logger.info(`[SERVER] Sanctuary Real-Time Chess SSE Service online on port ${port} (DB: ${dbPath})`);
