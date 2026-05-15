import { ReplBridge } from '../src/transport/repl-bridge.js';

describe('ReplBridge timeout handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('terminates the REPL process and rejects pending requests after a timeout', () => {
    const bridge = new ReplBridge();
    const kill = jest.fn();
    const timer = setTimeout(() => undefined, 5000);
    const rejected: Error[] = [];

    (bridge as unknown as { proc: unknown }).proc = {
      exitCode: null,
      killed: false,
      kill,
    };
    (
      bridge as unknown as {
        pending: Map<
          string,
          {
            resolve: (value: unknown) => void;
            reject: (reason: Error) => void;
            events: unknown[];
            timer?: ReturnType<typeof setTimeout>;
          }
        >;
      }
    ).pending.set('req-other', {
      resolve: jest.fn(),
      reject: (error: Error) => rejected.push(error),
      events: [],
      timer,
    });

    (
      bridge as unknown as {
        terminateAfterTimeout: (message: string, exceptRequestId?: string) => void;
      }
    ).terminateAfterTimeout('mcpserver-repl timed out');

    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect((bridge as unknown as { proc: unknown }).proc).toBeNull();
    expect(rejected[0].message).toBe('mcpserver-repl timed out');
    expect(
      (
        bridge as unknown as {
          pending: Map<string, unknown>;
        }
      ).pending.size,
    ).toBe(0);

    jest.advanceTimersByTime(2000);

    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });
});
