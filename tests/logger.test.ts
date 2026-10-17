import { describe, expect, it } from 'bun:test';
import { ExecutionSideEnum } from '../src/types';
import {
  createSanctuaryLogger,
  detectExecutionSide,
  getExecutionContextInfo,
  logExecutionContext
} from '../src/utils/logger';

describe('Pretty tslog Logger & Client/Server Execution Side Detection', () => {
  it('detects SERVER_SIDE in Bun/Node test runner by default', () => {
    const side = detectExecutionSide();
    expect(side).toBe(ExecutionSideEnum.ServerSide);

    const ctx = getExecutionContextInfo();
    expect(ctx.side).toBe(ExecutionSideEnum.ServerSide);
    expect(ctx.isServer).toBe(true);
    expect(ctx.isClient).toBe(false);
    expect(ctx.runtimeLabel).toContain('Bun');
  });

  it('detects CLIENT_SIDE when browser DOM & window probe are active', () => {
    const side = detectExecutionSide({
      hasWindow: true,
      hasDocument: true,
      hasBunOrNodeProcess: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
    });
    expect(side).toBe(ExecutionSideEnum.ClientSide);

    const ctx = getExecutionContextInfo({
      hasWindow: true,
      hasDocument: true,
      hasBunOrNodeProcess: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
    });
    expect(ctx.side).toBe(ExecutionSideEnum.ClientSide);
    expect(ctx.isClient).toBe(true);
    expect(ctx.isServer).toBe(false);
    expect(ctx.runtimeLabel).toContain('iPhone');

    const fallbackServer = detectExecutionSide({
      hasWindow: true,
      hasDocument: false,
      hasBunOrNodeProcess: false
    });
    expect(fallbackServer).toBe(ExecutionSideEnum.ServerSide);
  });

  it('configures tslog with pretty format and attaches executionSide metadata', () => {
    const capturedRecords: any[] = [];
    const clientLogger = createSanctuaryLogger('TestClientLogger', {
      hasWindow: true,
      hasDocument: true,
      hasBunOrNodeProcess: false
    });

    expect(clientLogger.settings.type).toBe('pretty');
    expect(clientLogger.settings.prefix).toContain('[CLIENT_SIDE]');

    clientLogger.attachTransport(record => {
      capturedRecords.push(record);
    });

    clientLogger.info('Testing client-side pretty log output', { mode: 'minimax' });
    expect(capturedRecords.length).toBe(1);

    const serverInfo = logExecutionContext(
      'TestServerScope',
      { memoryMB: 512 },
      { hasWindow: false, hasDocument: false, hasBunOrNodeProcess: true }
    );
    expect(serverInfo.side).toBe(ExecutionSideEnum.ServerSide);
    expect(serverInfo.isServer).toBe(true);

    const clientInfo = logExecutionContext(
      'TestMobileClientScope',
      { deviceTier: 'mobile-lite', ramGB: 2 },
      {
        hasWindow: true,
        hasDocument: true,
        hasBunOrNodeProcess: false,
        userAgent: 'Android Mobile Chrome'
      }
    );
    expect(clientInfo.side).toBe(ExecutionSideEnum.ClientSide);
    expect(clientInfo.isClient).toBe(true);
  });
});
