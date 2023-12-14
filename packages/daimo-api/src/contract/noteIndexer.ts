import {
  DaimoNoteStatus,
  amountToDollars,
  assertNotNull,
  getEAccountStr,
} from "@daimo/common";
import { Pool } from "pg";
import { Address, Hex, bytesToHex, getAddress } from "viem";

import { NameRegistry } from "./nameRegistry";
import { chainConfig } from "../env";

type LogCoordinate = {
  logIndex: number;
  transactionHash: Hex;
};

/* Ephemeral notes contract. Tracks note creation and redemption. */
export class NoteIndexer {
  private notes: Map<Address, DaimoNoteStatus> = new Map();
  private listeners: ((logs: DaimoNoteStatus[]) => void)[] = [];
  private logCoordinateToNoteEvent: Map<
    LogCoordinate,
    [Address, "create" | "claim"]
  > = new Map();

  constructor(private nameReg: NameRegistry) {}

  async load(pg: Pool, from: bigint, to: bigint) {
    const startTime = Date.now();
    const logs: DaimoNoteStatus[] = [];
    logs.push(...(await this.loadCreated(pg, from, to)));
    logs.push(...(await this.loadRedeemed(pg, from, to)));
    console.log(
      `[NOTE] Loaded ${logs.length} notes in ${Date.now() - startTime}ms`
    );
    // Finally, invoke listeners to send notifications etc.
    const ls = this.listeners;
    ls.forEach((l) => l(logs));
  }

  addListener(listener: (log: DaimoNoteStatus[]) => void) {
    this.listeners.push(listener);
  }

  private async loadCreated(
    pg: Pool,
    from: bigint,
    to: bigint
  ): Promise<DaimoNoteStatus[]> {
    const result = await pg.query(
      `
        select
          tx_hash,
          log_idx,
          f,
          ephemeral_owner,
          amount
        from note_created
        where block_num >= $1
        and block_num <= $2
        and chain_id = $3
    `,
      [from, to, chainConfig.chainL2.id]
    );
    const logs = result.rows
      .map((r) => {
        return {
          transactionHash: bytesToHex(r.tx_hash, { size: 32 }),
          logIndex: r.log_idx,
          from: getAddress(bytesToHex(r.f, { size: 20 })),
          ephemeralOwner: getAddress(
            bytesToHex(r.ephemeral_owner, { size: 20 })
          ),
          amount: BigInt(r.amount),
        };
      })
      .map(async (log) => {
        console.log(`[NOTE] NoteCreated ${log.ephemeralOwner}`);
        if (this.notes.get(log.ephemeralOwner) != null) {
          throw new Error(
            `dupe NoteCreated: ${log.ephemeralOwner} ${log.transactionHash} ${log.logIndex}`
          );
        }
        const sender = await this.nameReg.getEAccount(log.from);
        const dollars = amountToDollars(log.amount);
        const newNote: DaimoNoteStatus = {
          status: "confirmed",
          dollars,
          link: {
            type: "note",
            previewSender: getEAccountStr(sender),
            previewDollars: dollars,
            ephemeralOwner: log.ephemeralOwner,
          },
          sender,
        };
        this.notes.set(log.ephemeralOwner, newNote);
        this.logCoordinateToNoteEvent.set(
          { logIndex: log.logIndex, transactionHash: log.transactionHash },
          [log.ephemeralOwner, "create"]
        );
        return newNote;
      });
    return await Promise.all(logs);
  }

  private async loadRedeemed(
    pg: Pool,
    from: bigint,
    to: bigint
  ): Promise<DaimoNoteStatus[]> {
    const result = await pg.query(
      `
        select
          tx_hash,
          log_idx,
          f,
          redeemer,
          ephemeral_owner,
          amount
      from note_redeemed
      where block_num >= $1
      and block_num <= $2
      and chain_id = $3
    `,
      [from, to, chainConfig.chainL2.id]
    );
    const logs = result.rows
      .map((r) => {
        return {
          transactionHash: bytesToHex(r.tx_hash, { size: 32 }),
          logIndex: r.log_idx,
          from: bytesToHex(r.f, { size: 20 }),
          redeemer: getAddress(bytesToHex(r.redeemer, { size: 20 })),
          ephemeralOwner: getAddress(
            bytesToHex(r.ephemeral_owner, { size: 20 })
          ),
          amount: BigInt(r.amount),
        };
      })
      .map(async (log) => {
        console.log(`[NOTE] NoteRedeemed ${log.ephemeralOwner}`);
        const logInfo = () =>
          `[${log.transactionHash} ${log.logIndex} ${log.ephemeralOwner}]`;
        // Find and sanity check the Note that was redeemed
        const note = this.notes.get(log.ephemeralOwner);
        if (note == null) {
          throw new Error(`bad NoteRedeemed, missing note: ${logInfo()}`);
        } else if (note.status !== "confirmed") {
          throw new Error(`bad NoteRedeemed, already claimed: ${logInfo()}`);
        } else if (note.dollars !== amountToDollars(log.amount)) {
          throw new Error(`bad NoteRedeemed, wrong amount: ${logInfo()}`);
        }
        // Mark as redeemed

        this.logCoordinateToNoteEvent.set(
          { logIndex: log.logIndex, transactionHash: log.transactionHash },
          [log.ephemeralOwner, "claim"]
        );
        assertNotNull(log.redeemer, "redeemer is null");
        assertNotNull(log.from, "from is null");
        note.status = log.redeemer === log.from ? "cancelled" : "claimed";
        note.claimer = await this.nameReg.getEAccount(log.redeemer);
        return note;
      });
    return await Promise.all(logs);
  }

  getNotebyLogCoordinate(transactionHash: Hex, logIndex: number) {
    const event = this.logCoordinateToNoteEvent.get({
      logIndex,
      transactionHash,
    });
    return event;
  }

  /** Gets note status, or null if the note is not yet indexed. */
  async getNoteStatus(
    ephemeralOwner: Address
  ): Promise<DaimoNoteStatus | null> {
    const ret = this.notes.get(ephemeralOwner);
    return ret || null;
  }
}
