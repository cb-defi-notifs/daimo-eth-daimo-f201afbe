import { DaimoLinkNote, DaimoNoteStatus, EAccount } from "@daimo/common";
import { DaimoNonceMetadata, DaimoNonceType } from "@daimo/userop";
import assert from "node:assert";
import test from "node:test";
import { Address, Hex, getAddress } from "viem";

import { Transfer } from "../src/contract/coinIndexer";
import { KeyRegistry, KeyChange } from "../src/contract/keyRegistry";
import { NameRegistry } from "../src/contract/nameRegistry";
import { OpIndexer } from "../src/contract/opIndexer";
import { PushNotifier } from "../src/server/pushNotifier";

const addrAlice = getAddress("0x061b0a794945fe0Ff4b764bfB926317f3cFc8b94");
const addrBob = getAddress("0x061b0a794945fe0Ff4b764bfB926317f3cFc8b93");
const addrCharlie = getAddress("0x061b0a794945fe0Ff4b764bfB926317f3cFc8b95");

test("PushNotifier", async () => {
  const pn = createNotifierAliceBob();

  await test("transfer between two Daimo accounts", async () => {
    const input: Transfer[] = [
      createTransfer({ from: addrAlice, to: addrBob, value: 1000000n }),
    ];
    const output = await pn.getPushMessagesFromTransfers(input);

    assert.strictEqual(output.length, 2);
    assert.deepStrictEqual(output[0].to, ["pushTokenAlice"]);
    assert.strictEqual(output[0].title, "Sent $1.00");
    assert.strictEqual(output[0].body, "You sent 1.00 USDC to bob");

    assert.deepStrictEqual(output[1].to, ["pushTokenBob1", "pushTokenBob2"]);
    assert.strictEqual(output[1].title, "Received $1.00");
    assert.strictEqual(output[1].body, "You received 1.00 USDC from alice");
  });

  await test("transfer to external address", async () => {
    const input: Transfer[] = [
      createTransfer({ from: addrAlice, to: addrCharlie, value: 690000n }),
    ];
    const output = await pn.getPushMessagesFromTransfers(input);

    assert.strictEqual(output.length, 1);
    assert.deepStrictEqual(output[0].to, ["pushTokenAlice"]);
    assert.strictEqual(output[0].title, "Sent $0.69");
    assert.strictEqual(output[0].body, "You sent 0.69 USDC to charlie.eth");
  });

  await test("transfer fulfilling request", async () => {
    const input: Transfer[] = [
      createTransfer({
        from: addrCharlie,
        to: addrAlice,
        value: 5000000n,
        isRequestResponse: true,
      }),
    ];
    const output = await pn.getPushMessagesFromTransfers(input);

    assert.strictEqual(output.length, 1);
    assert.deepStrictEqual(output[0].to, ["pushTokenAlice"]);
    assert.strictEqual(output[0].title, "Received $5.00");
    assert.strictEqual(
      output[0].body,
      "charlie.eth fulfilled your 5.00 USDC request"
    );
  });

  const paymentLinkFromAlice: DaimoLinkNote = {
    type: "note",
    previewSender: "alice",
    previewDollars: "1.00",
    ephemeralOwner: "0x0",
  };

  await test("send payment link", async () => {
    const input: DaimoNoteStatus[] = [
      {
        status: "confirmed",
        sender: { addr: addrAlice, name: "alice" },
        dollars: "1.00",
        link: paymentLinkFromAlice,
      },
    ];
    const output = pn.getPushMessagesFromNoteOps(input);

    assert.strictEqual(output.length, 1);
    assert.deepStrictEqual(output[0].to, ["pushTokenAlice"]);
    assert.strictEqual(output[0].title, "Sent $1.00");
    assert.strictEqual(output[0].body, "You sent 1.00 USDC to a payment link");
  });

  await test("claim payment link", async () => {
    const input: DaimoNoteStatus[] = [
      {
        status: "claimed",
        sender: { addr: addrAlice, name: "alice" },
        claimer: { addr: addrBob, name: "bob" },
        dollars: "1.00",
        link: paymentLinkFromAlice,
      },
    ];
    const output = pn.getPushMessagesFromNoteOps(input);

    assert.strictEqual(output.length, 2);
    assert.deepStrictEqual(output[0].to, ["pushTokenAlice"]);
    assert.strictEqual(output[0].title, "$1.00 claimed");
    assert.strictEqual(
      output[0].body,
      "bob claimed your 1.00 USDC payment link"
    );
    assert.deepStrictEqual(output[1].to, ["pushTokenBob1", "pushTokenBob2"]);
    assert.strictEqual(output[1].title, "Received $1.00");
    assert.strictEqual(output[1].body, "You received 1.00 USDC from alice");
  });

  await test("simple remove device", async () => {
    const input: KeyChange[] = [
      createKeyRotation({
        from: addrAlice,
        keySlot: 0,
        isDeploymentLog: true,
        change: "added",
      }),
      createKeyRotation({
        from: addrAlice,
        keySlot: 0,
        isDeploymentLog: false,
        change: "removed",
      }),
    ];
    const output = pn.getPushMessagesFromKeyRotations(input);

    assert.strictEqual(output.length, 1);
    assert.deepStrictEqual(output[0].to, ["pushTokenAlice"]);
    assert.strictEqual(output[0].title, "Phone A removed");
    assert.strictEqual(output[0].body, "You removed Phone A from your account");
  });

  await test("complex add/removes", async () => {
    const input: KeyChange[] = [
      createKeyRotation({
        from: addrBob,
        keySlot: 0,
        isDeploymentLog: true,
        change: "added",
      }),
      createKeyRotation({
        from: addrAlice,
        keySlot: 0,
        isDeploymentLog: true,
        change: "added",
      }),
      createKeyRotation({
        from: addrBob,
        keySlot: 128,
        isDeploymentLog: false,
        change: "added",
      }),
      createKeyRotation({
        from: addrBob,
        keySlot: 0,
        isDeploymentLog: false,
        change: "removed",
      }),
      createKeyRotation({
        from: addrBob,
        keySlot: 25,
        isDeploymentLog: false,
        change: "added",
      }),
    ];
    const output = pn.getPushMessagesFromKeyRotations(input);
    assert.strictEqual(output.length, 3);
    for (const msg of output) {
      assert.deepStrictEqual(msg.to, ["pushTokenBob1", "pushTokenBob2"]);
    }
    assert.strictEqual(output[0].title, "Passkey Backup A added");
    assert.strictEqual(
      output[0].body,
      "You added Passkey Backup A to your account"
    );
    assert.strictEqual(output[1].title, "Phone A removed");
    assert.strictEqual(output[2].title, "Phone Z added");
  });

  await test("cancel payment link", async () => {
    const input: DaimoNoteStatus[] = [
      {
        status: "cancelled",
        sender: { addr: addrAlice, name: "alice" },
        claimer: { addr: addrAlice, name: "alice" },
        dollars: "4.20",
        link: paymentLinkFromAlice,
      },
    ];
    const output = pn.getPushMessagesFromNoteOps(input);

    assert.strictEqual(output.length, 1);
    assert.deepStrictEqual(output[0].to, ["pushTokenAlice"]);
    assert.strictEqual(output[0].title, "$4.20 claimed");
    assert.strictEqual(
      output[0].body,
      "You cancelled your 4.20 USDC payment link"
    );
  });
});

// Mock a world with two Daimo accounts, alice and bob
function createNotifierAliceBob() {
  const stubNameReg = {
    getEAccount: async (addr: Address): Promise<EAccount> => {
      if (addr === addrAlice) return { addr, name: "alice" };
      if (addr === addrBob) return { addr, name: "bob" };
      if (addr === addrCharlie) return { addr, ensName: "charlie.eth" };
      throw new Error(`Invalid addr ${addr}`);
    },
  } as unknown as NameRegistry;

  const stubOpIndexer = {
    fetchNonceMetadata: (
      txHash: Hex,
      queryLogIndex: number
    ): Hex | undefined => {
      if (txHash === "0x42")
        return new DaimoNonceMetadata(DaimoNonceType.RequestResponse).toHex();
      return undefined;
    },
  } as unknown as OpIndexer;

  const stubKeyReg = {
    isDeploymentKeyRotationLog: (log: KeyChange): boolean => {
      return log.transactionHash === "0x42";
    },
  } as unknown as KeyRegistry;

  const nullAny = null as any;
  const pn = new PushNotifier(
    nullAny,
    stubNameReg,
    nullAny,
    stubOpIndexer,
    stubKeyReg,
    nullAny
  );
  pn.pushTokens.set(addrAlice, ["pushTokenAlice"]);
  pn.pushTokens.set(addrBob, ["pushTokenBob1", "pushTokenBob2"]);

  return pn;
}

function createTransfer(args: {
  from: Address;
  to: Address;
  value: bigint;
  isRequestResponse?: boolean;
}): Transfer {
  return {
    address: "0x0",
    blockHash: "0x0",
    blockNumber: 0n,
    transactionHash: args.isRequestResponse ? "0x42" : "0x0",
    transactionIndex: 0,
    logIndex: 0,
    from: args.from,
    to: args.to,
    value: args.value,
  };
}

function createKeyRotation(args: {
  from: Address;
  keySlot: number;
  isDeploymentLog: boolean;
  change: "added" | "removed";
}): KeyChange {
  return {
    change: args.change,
    address: args.from,
    blockNumber: 0n,
    transactionHash: args.isDeploymentLog ? "0x42" : "0x0",
    logIndex: 0,
    account: args.from,
    keySlot: args.keySlot,
    key: ["0x0", "0x0"],
  };
}
