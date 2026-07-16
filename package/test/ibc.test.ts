import { describe, it, expect, inject } from 'vitest';
import { SigningStargateClient, StargateClient, GasPrice } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { MsgTransfer } from 'cosmjs-types/ibc/applications/transfer/v1/tx';

const wasmARpcUrl = inject('wasmARpcUrl');
const wasmBRpcUrl = inject('wasmBRpcUrl');
const gaiaRpcUrl = inject('gaiaRpcUrl');
const mnemonic = inject('testMnemonic');

async function ibcTransfer(opts: {
  senderRpcUrl: string;
  receiverRpcUrl: string;
  senderPrefix: string;
  receiverPrefix: string;
  denom: string;
  amount: string;
  channel: string;
}) {
  const senderWallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: opts.senderPrefix });
  const receiverWallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: opts.receiverPrefix });
  const [sender] = await senderWallet.getAccounts();
  const [receiver] = await receiverWallet.getAccounts();

  const signingClient = await SigningStargateClient.connectWithSigner(opts.senderRpcUrl, senderWallet, {
    gasPrice: GasPrice.fromString(`0${opts.denom}`),
  });

  const transferMsg = {
    typeUrl: '/ibc.applications.transfer.v1.MsgTransfer',
    value: MsgTransfer.fromPartial({
      sourcePort: 'transfer',
      sourceChannel: opts.channel,
      token: { denom: opts.denom, amount: opts.amount },
      sender: sender.address,
      receiver: receiver.address,
      timeoutTimestamp: BigInt((Math.floor(Date.now() / 1000) + 600) * 1_000_000_000),
    }),
  };

  const result = await signingClient.signAndBroadcast(sender.address, [transferMsg], 'auto');
  expect(result.code).toBe(0);
  signingClient.disconnect();

  // Poll for IBC denom on receiver
  const queryClient = await StargateClient.connect(opts.receiverRpcUrl);
  let ibcBalance;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2_000));
    const balances = await queryClient.getAllBalances(receiver.address);
    ibcBalance = balances.find(b => b.denom.startsWith('ibc/'));
    if (ibcBalance) break;
  }
  queryClient.disconnect();

  return ibcBalance;
}

describe('IBC transfer', () => {
  it('wasmA -> wasmB', async () => {
    const ibcBalance = await ibcTransfer({
      senderRpcUrl: wasmARpcUrl,
      receiverRpcUrl: wasmBRpcUrl,
      senderPrefix: 'wasm',
      receiverPrefix: 'wasm',
      denom: 'stake',
      amount: '1000000',
      channel: 'channel-0',
    });

    expect(ibcBalance).toBeTruthy();
    expect(BigInt(ibcBalance!.amount)).toBe(1000000n);
  }, 90_000);

  it('wasmA -> gaia', async () => {
    const ibcBalance = await ibcTransfer({
      senderRpcUrl: wasmARpcUrl,
      receiverRpcUrl: gaiaRpcUrl,
      senderPrefix: 'wasm',
      receiverPrefix: 'cosmos',
      denom: 'stake',
      amount: '500000',
      channel: 'channel-1',
    });

    expect(ibcBalance).toBeTruthy();
    expect(BigInt(ibcBalance!.amount)).toBe(500000n);
  }, 90_000);
});
