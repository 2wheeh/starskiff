import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { findFreePorts } from '../src/index.js';

describe('findFreePorts', () => {
  it('returns distinct ports', async () => {
    const ports = await findFreePorts();
    const values = [
      ports.rpcPort,
      ports.grpcPort,
      ports.apiPort,
      ports.p2pPort,
      ports.grpcWebPort,
      ports.pprofPort,
    ];

    expect(new Set(values).size).toBe(values.length);
    expect(ports.evmPort).toBeUndefined();
  });

  it('returns ports that are all bindable', async () => {
    const ports = await findFreePorts();
    const values = [
      ports.rpcPort,
      ports.grpcPort,
      ports.apiPort,
      ports.p2pPort,
      ports.grpcWebPort,
      ports.pprofPort,
    ];

    for (const port of values) {
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(port, () => {
          server.close(() => resolve());
        });
      });
    }
  });

  it('adds a distinct evmPort when opts.evm is set', async () => {
    const ports = await findFreePorts({ evm: true });
    const values = [
      ports.rpcPort,
      ports.grpcPort,
      ports.apiPort,
      ports.p2pPort,
      ports.grpcWebPort,
      ports.pprofPort,
      ports.evmPort,
    ];

    expect(ports.evmPort).toBeTypeOf('number');
    expect(new Set(values).size).toBe(values.length);
  });
});
