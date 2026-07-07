import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as Instance from '../Instance.js';
import { DEFAULT_COSMOS_EVM_PK_TYPE_URL, type CosmosInstance } from '../cosmos.js';
import { createProcess } from '../process.js';
import { stripColors } from '../utils.js';

export type HermesParameters = {
  /** Path to the hermes binary. @default "hermes" */
  binary?: string;
  /** IBC channel pairs to relay. Each tuple is [chain, chain]. */
  channels: [CosmosInstance, CosmosInstance][];
  /** Mnemonic for the relayer account (must be funded on all chains). */
  mnemonic: string;
  /** Gas price amount. @default "0.025" */
  gasPrice?: string;
  /** Telemetry port. @default 3001 */
  telemetryPort?: number;
  /** Enable verbose Hermes setup logs. @default false */
  debug?: boolean;
  /** Timeout for each Hermes command in milliseconds. @default 300000 (600000 in CI) */
  commandTimeoutMs?: number;
  /** Number of retries for setup commands. @default 0 (2 in CI) */
  commandRetries?: number;
  /** Delay between retries in milliseconds. @default 5000 */
  commandRetryDelayMs?: number;
};

type HandshakeType = 'connection' | 'channel';

type HandshakeCounts = {
  init: number;
  try: number;
  ack: number;
  confirm: number;
};

function isStreamingCommand(args: string[]): args is ['create', HandshakeType, ...string[]] {
  return args[0] === 'create' && (args[1] === 'connection' || args[1] === 'channel');
}

function extractLastMatch(input: string, pattern: RegExp): string | undefined {
  const matches = input.match(pattern);
  return matches && matches.length > 0 ? matches[matches.length - 1] : undefined;
}

function extractMatches(input: string, pattern: RegExp): string[] {
  const matches = input.match(pattern) ?? [];
  return [...new Set(matches)];
}

function hasOpenState(input: string): boolean {
  return /STATE_OPEN|\bOpen\b|\bOPEN\b/.test(input);
}

function hasIdentifiers(input: string, identifiers: string[]): boolean {
  return identifiers.every(identifier => input.includes(identifier));
}

function parseHandshakeProgress(line: string, handshakeType: HandshakeType): keyof HandshakeCounts | undefined {
  const match = line.match(/Open(Init|Try|Ack|Confirm)(Connection|Channel)/);
  if (!match) return undefined;

  const [, step, kind] = match;
  if (kind.toLowerCase() !== handshakeType) return undefined;

  return step.toLowerCase() as keyof HandshakeCounts;
}

function summarizeError(error: Error): string {
  return error.message.trim().split('\n').slice(-3).join(' | ');
}

/**
 * Defines a Hermes IBC relayer instance.
 *
 * Connects two Cosmos SDK chains and relays IBC packets between them.
 * Both chains must be running before starting the relayer.
 * The relayer mnemonic must be funded on both chains via genesis accounts.
 *
 * @example
 * ```ts
 * const relayer = Instance.hermes({
 *   channels: [[chainA, chainB], [chainB, chainC]],
 *   mnemonic: RELAYER_MNEMONIC,
 * })
 * await relayer.start()
 * ```
 */
export const hermes = Instance.define((parameters: HermesParameters) => {
  const {
    binary = 'hermes',
    channels,
    mnemonic,
    gasPrice = '0.025',
    telemetryPort = 3001,
    debug = process.env.STARSKIFF_DEBUG_HERMES === '1',
    commandTimeoutMs = process.env.CI ? 600_000 : 300_000,
    commandRetries = process.env.CI ? 2 : 0,
    commandRetryDelayMs = 5_000,
  } = parameters;

  const uniqueChains = [...new Set(channels.flat())];

  const name = 'hermes';
  const processManager = createProcess(name);
  let homeDir: string | undefined;

  return {
    name,
    host: 'localhost',
    port: telemetryPort,

    async start(_opts, { emitter }) {
      homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starskiff-hermes-'));
      const configPath = path.join(homeDir, 'config.toml');
      const log = (message: string) => {
        emitter.emit('message', `[hermes-setup] ${message}\n`);
      };
      const debugLog = (message: string) => {
        if (debug) log(message);
      };

      // 1. Write config (derive URLs from chain instances)
      fs.writeFileSync(configPath, generateConfig({ chains: uniqueChains, gasPrice, telemetryPort }));
      debugLog(`wrote config: ${configPath}`);

      const shouldAnnounceCommand = (args: string[]) => debug || isStreamingCommand(args);

      const logCommandFailure = (args: string[], error: Error) => {
        const message = summarizeError(error);
        if (message) log(`failed: hermes ${args.join(' ')} => ${message}`);
      };

      const runSyncCommand = (args: string[], attempt: number, retries: number) => {
        const result = spawnSync(binary, ['--config', configPath, ...args], {
          stdio: 'pipe',
          timeout: commandTimeoutMs,
        });
        const stderr = result.stderr?.toString() || '';
        const stdout = result.stdout?.toString() || '';

        if (result.status !== 0) {
          const tail = `${stderr}\n${stdout}`.trim().split('\n').slice(-3).join(' | ');
          if (tail) {
            log(`failed: hermes ${args.join(' ')} => ${tail}`);
          }

          throw new Error(
            `hermes ${args.join(' ')} failed (exit ${result.status}, signal ${result.signal}, attempt ${attempt + 1}/${retries + 1}):\n${stderr}\n${stdout}`,
          );
        }

        return stdout + stderr;
      };

      const streamCommandOutput = async (args: string[]) => {
        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];
        const handshakeType = isStreamingCommand(args) ? args[1] : undefined;
        const handshakeCounts: HandshakeCounts = {
          init: 0,
          try: 0,
          ack: 0,
          confirm: 0,
        };
        let lastHandshakeStep: string | undefined;

        const recordHandshakeProgress = (line: string) => {
          if (!handshakeType) return;

          const normalizedStep = parseHandshakeProgress(line, handshakeType);
          if (!normalizedStep) return;

          handshakeCounts[normalizedStep] += 1;
          lastHandshakeStep = normalizedStep[0].toUpperCase() + normalizedStep.slice(1);
          log(
            `progress: ${handshakeType} handshake ${lastHandshakeStep} ` +
              `(init=${handshakeCounts.init}, try=${handshakeCounts.try}, ack=${handshakeCounts.ack}, confirm=${handshakeCounts.confirm})`,
          );
        };

        await new Promise<void>((resolve, reject) => {
          const child = spawn(binary, ['--config', configPath, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });

          let stdoutBuffer = '';
          let stderrBuffer = '';

          const flushBuffer = (buffer: string) => {
            const lines = buffer.split('\n');
            const remainder = lines.pop() ?? '';
            for (const line of lines) {
              const text = stripColors(line).trim();
              if (text) recordHandshakeProgress(text);
            }
            return remainder;
          };

          const timer = setTimeout(() => {
            child.kill('SIGTERM');
          }, commandTimeoutMs);

          child.stdout?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            stdoutChunks.push(chunk);
            stdoutBuffer += chunk;
            stdoutBuffer = flushBuffer(stdoutBuffer);
          });

          child.stderr?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            stderrChunks.push(chunk);
            stderrBuffer += chunk;
            stderrBuffer = flushBuffer(stderrBuffer);
          });

          child.on('error', error => {
            clearTimeout(timer);
            reject(error);
          });

          child.on('close', (code, signal) => {
            clearTimeout(timer);

            const stdoutRemainder = stripColors(stdoutBuffer).trim();
            if (stdoutRemainder) recordHandshakeProgress(stdoutRemainder);
            const stderrRemainder = stripColors(stderrBuffer).trim();
            if (stderrRemainder) recordHandshakeProgress(stderrRemainder);

            if (handshakeType) {
              log(
                `summary: ${handshakeType} handshake ` +
                  `init=${handshakeCounts.init}, try=${handshakeCounts.try}, ack=${handshakeCounts.ack}, confirm=${handshakeCounts.confirm}, ` +
                  `last=${lastHandshakeStep ?? 'none'}`,
              );
            }

            if (code === 0) {
              resolve();
              return;
            }

            reject(
              new Error(
                `hermes ${args.join(' ')} failed (exit ${code}, signal ${signal}):\n${stderrChunks.join('')}\n${stdoutChunks.join('')}`,
              ),
            );
          });
        });

        return stdoutChunks.join('') + stderrChunks.join('');
      };

      const run = async (args: string[], retries = commandRetries) => {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= retries; attempt++) {
          if (shouldAnnounceCommand(args)) {
            log(`run: hermes ${args.join(' ')} (attempt ${attempt + 1}/${retries + 1})`);
          }
          try {
            const output = isStreamingCommand(args)
              ? await streamCommandOutput(args)
              : runSyncCommand(args, attempt, retries);

            if (shouldAnnounceCommand(args)) {
              log(`ok: hermes ${args.join(' ')}`);
            }
            return output;
          } catch (error) {
            lastError = error as Error;
            if (isStreamingCommand(args)) {
              logCommandFailure(args, lastError);
            }
          }

          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, commandRetryDelayMs));
          }
        }

        throw lastError;
      };

      // 2. Add relayer key to both chains
      const mnemonicFile = path.join(homeDir, 'mnemonic.txt');
      fs.writeFileSync(mnemonicFile, mnemonic);
      debugLog(`wrote mnemonic file: ${mnemonicFile}`);

      for (const chain of uniqueChains) {
        debugLog(`adding key for chain ${chain.chainId}`);
        const hdPath = chain.relayerHints?.hdPath ?? "m/44'/118'/0'/0/0";
        await run([
          'keys', 'add',
          '--chain', chain.chainId,
          '--mnemonic-file', mnemonicFile,
          '--hd-path', hdPath,
          '--overwrite',
        ]);
      }

      // 3. Verify chains are reachable
      debugLog('running health-check');
      await run(['health-check']);

      // 4. Create clients, connection, and channel for each pair
      for (const [chainA, chainB] of channels) {
        debugLog(`creating client on ${chainA.chainId} -> ${chainB.chainId}`);
        const clientAOutput = await run([
          'create',
          'client',
          '--host-chain',
          chainA.chainId,
          '--reference-chain',
          chainB.chainId,
        ]);
        debugLog(`creating client on ${chainB.chainId} -> ${chainA.chainId}`);
        const clientBOutput = await run([
          'create',
          'client',
          '--host-chain',
          chainB.chainId,
          '--reference-chain',
          chainA.chainId,
        ]);
        const clientAId = extractLastMatch(clientAOutput, /07-tendermint-\d+/g);
        const clientBId = extractLastMatch(clientBOutput, /07-tendermint-\d+/g);
        if (!clientAId || !clientBId) {
          log(`client creation failed — a: ${clientAId ?? 'not found'}, b: ${clientBId ?? 'not found'}`);
          log(`clientA output: ${clientAOutput.trim().split('\n').slice(-3).join(' | ')}`);
          log(`clientB output: ${clientBOutput.trim().split('\n').slice(-3).join(' | ')}`);
          throw new Error(
            `Failed to create IBC clients for ${chainA.chainId} <-> ${chainB.chainId}`,
          );
        }
        debugLog(`client ids: a=${clientAId}, b=${clientBId}`);

        const findExistingConnectionId = async () => {
          try {
            const out = await run(
              ['query', 'connections', '--chain', chainA.chainId, '--counterparty-chain', chainB.chainId, '--verbose'],
              0,
            );

            const candidates = extractMatches(out, /connection-\d+/g).reverse();
            for (const candidate of candidates) {
              const details = await run(
                ['query', 'connection', 'end', '--chain', chainA.chainId, '--connection', candidate],
                0,
              );

              if (hasOpenState(details) && hasIdentifiers(details, [clientAId, clientBId])) {
                return candidate;
              }
            }

            return undefined;
          } catch {
            return undefined;
          }
        };

        let connectionId: string | undefined;
        try {
          log(`creating connection ${chainA.chainId} <-> ${chainB.chainId}`);
          const connectionOutput = await run(
            ['create', 'connection', '--a-chain', chainA.chainId, '--a-client', clientAId, '--b-client', clientBId],
            Math.max(commandRetries, 1),
          );
          const allConnections = extractMatches(connectionOutput, /connection-\d+/g);
          connectionId = allConnections[0];
          log(`connection id: ${connectionId ?? 'unknown'}`);
        } catch (error) {
          log('create connection failed, trying to reuse existing connection');
          connectionId = await findExistingConnectionId();
          if (connectionId) log(`reused connection id: ${connectionId}`);
          if (!connectionId) throw error;
        }

        const findExistingChannelId = async () => {
          try {
            const out = await run(
              [
                'query',
                'channels',
                '--chain',
                chainA.chainId,
                '--counterparty-chain',
                chainB.chainId,
                '--show-counterparty',
                '--verbose',
              ],
              0,
            );

            const candidates = extractMatches(out, /channel-\d+/g).reverse();
            for (const candidate of candidates) {
              const details = await run(
                ['query', 'channel', 'end', '--chain', chainA.chainId, '--port', 'transfer', '--channel', candidate],
                0,
              );

              if (hasOpenState(details) && hasIdentifiers(details, [connectionId ?? 'connection-0', 'transfer'])) {
                return candidate;
              }
            }

            return undefined;
          } catch {
            return undefined;
          }
        };

        log(`creating channel on connection ${connectionId ?? 'connection-0'}`);
        try {
          await run(
            [
              'create',
              'channel',
              '--a-chain',
              chainA.chainId,
              '--a-connection',
              connectionId ?? 'connection-0',
              '--a-port',
              'transfer',
              '--b-port',
              'transfer',
            ],
            Math.max(commandRetries, 1),
          );
        } catch (error) {
          log('create channel failed, trying to reuse existing channel');
          const channelId = await findExistingChannelId();
          if (channelId) {
            log(`reused channel id: ${channelId}`);
          } else {
            throw error;
          }
        }
      }
      log('all channels ready, starting relayer');

      // 4. Start relaying
      return processManager.start(binary, ['--config', configPath, 'start'], {
        emitter,
        resolver({ process: proc, resolve, reject }) {
          let resolved = false;

          const check = (data: Buffer) => {
            if (resolved) return;
            const msg = data.toString();
            if (msg.includes('Hermes has started') || msg.includes('spawning supervisor')) {
              resolved = true;
              setTimeout(resolve, 2000);
            }
          };

          proc.process?.stdout?.on('data', check);
          proc.process?.stderr?.on('data', check);

          proc.process?.on('exit', (code: number | null) => {
            if (!resolved) {
              reject(`hermes exited with code ${code}`);
            }
          });
        },
      });
    },

    async stop() {
      await processManager.stop();
      if (homeDir) {
        fs.rmSync(homeDir, { recursive: true, force: true });
        homeDir = undefined;
      }
    },
  };
});

function generateConfig(opts: {
  chains: CosmosInstance[];
  gasPrice: string;
  telemetryPort: number;
}): string {
  const { chains, gasPrice, telemetryPort } = opts;

  function chainSection(chain: CosmosInstance): string {
    const rpcUrl = `http://${chain.host}:${chain.port}`;
    const grpcUrl = `http://${chain.host}:${chain.grpcPort}`;

    // Assemble `address_type` inline-table from instance-advertised hints.
    // Hermes cosmos derivation has no `proto_type` slot — only ethermint does.
    const hints = chain.relayerHints;
    const derivation = hints?.addressDerivation ?? 'cosmos';
    const protoTypePart =
      hints?.addressDerivation === 'ethermint'
        ? `, proto_type = { pk_type = '${hints.pkTypeUrl ?? DEFAULT_COSMOS_EVM_PK_TYPE_URL}' }`
        : '';

    return `
[[chains]]
id = '${chain.chainId}'
type = 'CosmosSdk'
rpc_addr = '${rpcUrl}'
grpc_addr = '${grpcUrl}'
event_source = { mode = 'push', url = '${rpcUrl.replace('http', 'ws')}/websocket', batch_delay = '500ms' }
account_prefix = '${chain.prefix}'
key_name = 'relayer'
store_prefix = 'ibc'
default_gas = 1000000
max_gas = 10000000
gas_price = { price = ${gasPrice}, denom = '${chain.denom}' }
gas_multiplier = 1.2
max_msg_num = 30
max_tx_size = 180000
clock_drift = '5s'
max_block_time = '10s'
trusting_period = '14days'
memo_prefix = ''
sequential_batch_tx = false
trust_threshold = { numerator = '1', denominator = '3' }
address_type = { derivation = '${derivation}'${protoTypePart} }
`;
  }

  return `[global]
log_level = 'info'

[mode]

[mode.clients]
enabled = true
refresh = true
misbehaviour = false

[mode.connections]
enabled = false

[mode.channels]
enabled = false

[mode.packets]
enabled = true
clear_interval = 100
clear_on_start = true
tx_confirmation = false

[rest]
enabled = false
host = '127.0.0.1'
port = 3000

[telemetry]
enabled = false
host = '127.0.0.1'
port = ${telemetryPort}
${chains.map(chainSection).join('')}
`;
}
