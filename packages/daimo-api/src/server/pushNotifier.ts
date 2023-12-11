import {
  AddrLabel,
  DaimoNoteStatus,
  assert,
  assertNotNull,
  getAccountName,
  getSlotLabel,
} from "@daimo/common";
import { DaimoNonceMetadata, DaimoNonceType } from "@daimo/userop";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { Address, Hex, formatUnits, getAddress } from "viem";

import { CoinIndexer, Transfer } from "../contract/coinIndexer";
import { KeyRegistry, KeyChange } from "../contract/keyRegistry";
import { NameRegistry } from "../contract/nameRegistry";
import { NoteIndexer } from "../contract/noteIndexer";
import { OpIndexer } from "../contract/opIndexer";
import { DB } from "../db/db";
import { chainConfig } from "../env";

const pushEnabled = process.env.DAIMO_PUSH_ENABLED === "true";

/**
 * Subscribes to coin transfers onchain. Whenever a transfer affects a Daimo
 * account, sends a push notification to each of the user's devices.
 */
export class PushNotifier {
  pushTokens = new Map<Address, string[]>();
  expo = new Expo();

  isInitialized = false;

  constructor(
    private coinIndexer: CoinIndexer,
    private nameReg: NameRegistry,
    private noteIndexer: NoteIndexer,
    private opIndexer: OpIndexer,
    private keyReg: KeyRegistry,
    private db: DB
  ) {}

  async init() {
    this.coinIndexer.addListener(this.handleTransfers);
    this.noteIndexer.addListener(this.handleNoteOps);
    this.keyReg.addListener(this.handleKeyRotations);

    // Load Expo push notification tokens
    const rows = await this.db.loadPushTokens();
    console.log(`[PUSH] loaded ${rows.length} push tokens from DB`);
    for (const row of rows) {
      this.cachePushToken(getAddress(row.address), row.pushtoken);
    }

    this.isInitialized = true;
  }

  private handleNoteOps = async (logs: DaimoNoteStatus[]) => {
    console.log(`[PUSH] got ${logs.length} note ops`);
    const messages = this.getPushMessagesFromNoteOps(logs);
    this.maybeSendNotifications(messages);
  };

  private handleTransfers = async (logs: Transfer[]) => {
    console.log(`[PUSH] got ${logs.length} transfers`);
    const messages = await this.getPushMessagesFromTransfers(logs);
    this.maybeSendNotifications(messages);
  };

  private handleKeyRotations = async (logs: KeyChange[]) => {
    console.log(`[PUSH] got ${logs.length} key rotations`);
    const messages = this.getPushMessagesFromKeyRotations(logs);
    this.maybeSendNotifications(messages);
  };

  /** NOT MEANT TO BE CALLED DIRECTLY: Always use maybeSendNotifications */
  private async sendExpoNotifications(messages: ExpoPushMessage[]) {
    try {
      const chunks = this.expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        const receipts = await this.expo.sendPushNotificationsAsync(chunk);
        console.log(`[PUSH] sent ${receipts.length} receipts`);
      }
    } catch (e) {
      console.error(`[PUSH] error sending notifications: ${e}`);
    }
  }

  async maybeSendNotifications(messages: ExpoPushMessage[]) {
    // Log the notification. In local development, stop there.
    const verb = pushEnabled ? "notifying" : "NOT notifying";
    for (const msg of messages) {
      console.log(`[PUSH] ${verb} ${msg.to}: ${msg.title}: ${msg.body}`);
    }

    if (pushEnabled) {
      console.log(`[PUSH] sending ${messages.length} notifications`);
      if (messages.length !== 0) this.sendExpoNotifications(messages);
    }
  }

  async getPushMessagesFromTransfers(logs: Transfer[]) {
    const messages: ExpoPushMessage[] = [];
    for (const log of logs) {
      const { from, to, value } = log;
      const amount = Number(value);

      const logId = `${log.transactionHash}:${log.logIndex}`;
      if (from == null || to == null || amount == null) {
        console.warn(`[PUSH] invalid transfer log: ${logId}`);
        continue;
      }
      if (amount === 0) {
        console.log(`[PUSH] skipping zero-value transfer: ${logId}`);
        continue;
      }
      if (log.transactionHash == null) {
        console.warn(`[PUSH] skipping unconfirmed tx: ${logId}`);
        continue;
      }

      const nonceMetadata = this.opIndexer.fetchNonceMetadata(
        log.transactionHash,
        log.logIndex
      );

      const receivingRequestedMoney =
        nonceMetadata !== undefined &&
        DaimoNonceMetadata.fromHex(nonceMetadata)?.nonceType ===
          DaimoNonceType.RequestResponse;

      const [a, b] = await Promise.all([
        this.getPushMessagesFromTransfer(
          log.transactionHash,
          from,
          to,
          -BigInt(amount),
          false
        ),
        this.getPushMessagesFromTransfer(
          log.transactionHash,
          to,
          from,
          BigInt(amount),
          receivingRequestedMoney
        ),
      ]);
      messages.push(...a, ...b);
    }
    return messages;
  }

  /** Validates the push token, then subscribes to events affecting addr.  */
  async register(addr: Address, pushToken: string) {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.warn(`[PUSH] ignoring bad push token ${pushToken} for ${addr}`);
      return;
    }

    this.cachePushToken(addr, pushToken);

    await Promise.all([
      this.db.savePushToken({ address: addr, pushtoken: pushToken }),
      this.maybeSendNotifications([
        {
          to: pushToken,
          title: "Welcome to Daimo",
          body: "You'll get a notification when you receive a payment.",
        },
      ]),
    ]);
  }

  private cachePushToken(addr: Address, pushToken: string) {
    const tokens = this.pushTokens.get(addr) || [];
    if (tokens.includes(pushToken)) {
      console.log(`[PUSH] already registered ${pushToken} for ${addr}`);
      return;
    }

    console.log(`[PUSH] registering ${pushToken} for ${addr}`);
    this.pushTokens.set(addr, [...tokens, pushToken]);
  }

  private async getPushMessagesFromTransfer(
    txHash: Hex,
    addr: Address,
    other: Address,
    value: bigint,
    receivingRequestedMoney: boolean
  ): Promise<ExpoPushMessage[]> {
    const pushTokens = this.pushTokens.get(addr);
    if (!pushTokens || pushTokens.length === 0) return [];

    const { tokenDecimals, tokenSymbol } = chainConfig;
    const rawAmount = formatUnits(value, tokenDecimals);
    const dollars = Math.abs(Number(rawAmount)).toFixed(2);

    // Get the other side
    const otherAcc = await this.nameReg.getEAccount(other);
    if (otherAcc.label === AddrLabel.PaymentLink) {
      // Handled separately, see maybeNotifyPaymentLink
      return [];
    } else if (otherAcc.label === AddrLabel.Paymaster) {
      // ignore paymaster transfers
      return [];
    }
    const otherStr = getAccountName(otherAcc);

    const title = value < 0 ? `Sent $${dollars}` : `Received $${dollars}`;
    let body;
    if (value < 0) {
      body = `You sent ${dollars} ${tokenSymbol} to ${otherStr}`;
    } else if (receivingRequestedMoney) {
      body = `${otherStr} fulfilled your ${dollars} ${tokenSymbol} request`;
    } else {
      body = `You received ${dollars} ${tokenSymbol} from ${otherStr}`;
    }

    return [
      {
        to: pushTokens,
        badge: 1,
        title,
        body,
        data: { txHash },
      },
    ];
  }

  getPushMessagesFromNoteOps(logs: DaimoNoteStatus[]) {
    const symbol = chainConfig.tokenSymbol;

    const messages: ExpoPushMessage[] = [];
    for (const log of logs) {
      if (log.status === "confirmed") {
        // To Alice: "You sent $3.50 to a payment link"
        const { sender, dollars } = log;
        const title = `Sent $${dollars}`;
        const body = `You sent ${dollars} ${symbol} to a payment link`;
        messages.push(...this.getPushMessages(sender.addr, title, body));
      } else if (log.status === "claimed") {
        // To Bob: "You received $1.00 from alice"
        // To Alice: "Bob claimed your $1.00 payment link"
        const claimer = assertNotNull(log.claimer);
        const { sender, dollars } = log;
        assert(sender.addr !== claimer.addr);
        messages.push(
          ...this.getPushMessages(
            sender.addr,
            `$${dollars} claimed`,
            `${getAccountName(
              claimer
            )} claimed your ${dollars} ${symbol} payment link`
          ),
          ...this.getPushMessages(
            claimer.addr,
            `Received $${dollars}`,
            `You received ${dollars} ${symbol} from ${getAccountName(sender)}`
          )
        );
      } else {
        // To Alice: "You cancelled your $1.00 payment link"
        const { sender, dollars } = log;
        assert(log.status === "cancelled");
        assert(log.claimer?.addr === sender.addr);
        messages.push(
          ...this.getPushMessages(
            sender.addr,
            `$${dollars} claimed`,
            `You cancelled your ${dollars} ${symbol} payment link`
          )
        );
      }
    }

    return messages;
  }

  getPushMessagesFromKeyRotations(logs: KeyChange[]) {
    const messages: ExpoPushMessage[] = [];
    for (const log of logs) {
      const addr = getAddress(log.address);
      const keyLabel = getSlotLabel(log.keySlot);

      // Skip notifications for account creation
      if (this.keyReg.isDeploymentKeyRotationLog(log)) continue;

      if (log.change === "added") {
        const title = `${keyLabel} added`;
        const body = `You added ${keyLabel} to your account`;
        messages.push(...this.getPushMessages(addr, title, body));
      } else {
        assert(log.change === "removed");
        const title = `${keyLabel} removed`;
        const body = `You removed ${keyLabel} from your account`;
        messages.push(...this.getPushMessages(addr, title, body));
      }
    }

    return messages;
  }

  private getPushMessages(
    to: Address,
    title: string,
    body: string
  ): ExpoPushMessage[] {
    const pushTokens = this.pushTokens.get(to);
    if (pushTokens == null) return [];

    return [
      {
        to: pushTokens,
        badge: 1,
        title,
        body,
      },
    ];
  }
}
