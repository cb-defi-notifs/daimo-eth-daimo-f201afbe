import { AccountHistoryResult } from "@daimo/api";
import {
  DisplayOpEvent,
  EAccount,
  OpStatus,
  PaymentLinkOpEvent,
  TransferOpEvent,
  amountToDollars,
  assert,
  guessTimestampFromNum,
} from "@daimo/common";
import { DaimoChain, daimoChainFromId } from "@daimo/contract";
import * as SplashScreen from "expo-splash-screen";
import { Hex } from "viem";

import { getNetworkState, updateNetworkState } from "./networkState";
import { SEND_DEADLINE_SECS } from "../action/useSendAsync";
import { env } from "../logic/env";
import { Account, getAccountManager } from "../model/account";

// Sync strategy:
// - On app load, load account from storage
// - Then, sync from API
// - After, sync from API:
//   ...immediately on push notification
//   ...frequently while there's a pending transaction
//   ...occasionally otherwise
export function startSync() {
  console.log("[SYNC] APP LOAD, starting sync");
  maybeSync(true)
    .then((success) => {
      if (!success) {
        updateNetworkState(() => {
          // set fail to 3 because at 2 it would remove offline banner
          // for one try even if sync failed
          return { status: "offline", syncAttemptsFailed: 3 };
        });
      }
    })
    .finally(() => {
      // create small delay to let interface render becuase this callback
      // run right after getting data so the interface still got to adapt
      setTimeout(() => {
        SplashScreen.hideAsync();
      }, 300);
    });
  setInterval(maybeSync, 1_000);
}

let lastSyncS = 0;
let lastPushNotificationS = 0;

export function syncAfterPushNotification() {
  lastPushNotificationS = Date.now() / 1e3;
}

function hasPendingOps(account: Account) {
  return (
    account.recentTransfers.find((t) => t.status === "pending") != null ||
    account.pendingKeyRotation.length > 0
  );
}

async function maybeSync(fromScratch?: boolean) {
  const manager = getAccountManager();
  if (manager.currentAccount == null) return;
  const account = manager.currentAccount;

  // Synced recently? Wait first.
  const nowS = Date.now() / 1e3;
  let intervalS = 10;

  // Sync faster for 1. pending ops, and 2. recently-failed sync
  if (hasPendingOps(account)) {
    intervalS = 1;
  }

  const netState = getNetworkState();
  if (netState.status === "online" && netState.syncAttemptsFailed > 0) {
    intervalS = 1;
  }

  if (fromScratch) {
    return await resync(`initial sync from scratch`, true);
  } else if (lastPushNotificationS + 10 > nowS) {
    return await resync(
      `push notification ${nowS - lastPushNotificationS}s ago`
    );
  } else if (lastSyncS + intervalS > nowS) {
    console.log(`[SYNC] skipping sync, attempted sync recently`);
    return false;
  } else {
    return await resync(`interval ${intervalS}s`);
  }
}

/** Gets latest balance & history for this account, in the background. */
export async function resync(reason: string, fromScratch?: boolean) {
  const manager = getAccountManager();
  const accOld = manager.currentAccount;
  assert(!!accOld, `no account, skipping sync: ${reason}`);

  console.log(`[SYNC] RESYNC ${accOld.name}, ${reason}`);
  lastSyncS = Date.now() / 1e3;

  try {
    const res = await fetchSync(accOld, fromScratch);
    assert(!!manager.currentAccount, `account deleted during sync`);
    const accNew = applySync(manager.currentAccount, res);
    console.log(`[SYNC] SUCCEEDED ${accNew.name}`);
    manager.setCurrentAccount(accNew);
    // We are automatically marked online when any RPC req succeeds
    return true;
  } catch (e) {
    console.error(`[SYNC] FAILED ${accOld.name}`, e);
    // Mark offline
    updateNetworkState((state) => {
      const syncAttemptsFailed = state.syncAttemptsFailed + 1;
      return {
        syncAttemptsFailed,
        status: syncAttemptsFailed > 3 ? "offline" : "online",
      };
    });
    return false;
  }
}

/** Hydrate a newly created account to fill in properties from server */
export async function hydrateAccount(account: Account): Promise<Account> {
  const res = await fetchSync(account, true);
  return applySync(account, res);
}

/** Loads all account history since the last finalized block as of the previous sync.
 * This means we're guaranteed to see all events even if there were reorgs. */
async function fetchSync(
  account: Account,
  fromScratch?: boolean
): Promise<AccountHistoryResult> {
  const sinceBlockNum = fromScratch ? 0 : account.lastFinalizedBlock;

  const daimoChain = daimoChainFromId(account.homeChainId);
  const rpcFunc = env(daimoChain).rpcFunc;
  const result = await rpcFunc.getAccountHistory.query({
    address: account.address,
    sinceBlockNum,
  });
  const syncSummary = {
    address: account.address,
    name: account.name,
    sinceBlockNum,
    lastBlock: result.lastBlock,
    lastBlockTimestamp: result.lastBlockTimestamp,
    lastFinalizedBlock: result.lastFinalizedBlock,
    lastBalance: result.lastBalance,
    numTransfers: result.transferLogs.length,
    numNamedAccounts: result.namedAccounts.length,
    numAccountKeys: result.accountKeys.length,
    chainGasConstants: result.chainGasConstants,
    recommendedExchanges: result.recommendedExchanges,
    suggestedActions: result.suggestedActions,
  };
  console.log(`[SYNC] got history ${JSON.stringify(syncSummary)}`);

  // Validation
  assert(result.address === account.address);
  assert(result.sinceBlockNum === sinceBlockNum);
  assert(result.lastBlock >= result.sinceBlockNum);
  assert(result.lastBlockTimestamp > 0);
  assert(
    result.chainGasConstants.paymasterAddress.length % 2 === 0,
    `invalid paymasterAndData ${result.chainGasConstants.paymasterAddress}`
  );

  return result;
}

function applySync(account: Account, result: AccountHistoryResult): Account {
  assert(result.address === account.address);
  if (result.lastFinalizedBlock < account.lastFinalizedBlock) {
    console.log(
      `[SYNC] skipping sync result for ${account.address}. Server has finalized ` +
        `block ${result.lastFinalizedBlock} < local ${account.lastFinalizedBlock}`
    );
    return account;
  }

  // Sync in recent transfers
  // Start with finalized transfers only
  const oldFinalizedTransfers = account.recentTransfers.filter(
    (t) => t.blockNumber && t.blockNumber < result.sinceBlockNum
  );

  // Add newly onchain transfers
  const daimoChain = daimoChainFromId(account.homeChainId);
  const recentTransfers = addTransfers(
    oldFinalizedTransfers,
    result.transferLogs,
    daimoChain
  );

  // Mark finalized
  for (const t of recentTransfers) {
    if (t.blockNumber && t.blockNumber <= result.lastFinalizedBlock) {
      t.status = OpStatus.finalized;
    }
  }

  // Match pending transfers
  const oldPending = account.recentTransfers.filter(
    (t) => t.status === "pending"
  );

  // Match pending transfers
  // TODO: store validUntil directly on the op
  const stillPending = oldPending.filter(
    (t) =>
      syncFindSameOp(t.opHash, recentTransfers) == null &&
      t.timestamp + SEND_DEADLINE_SECS > result.lastBlockTimestamp
  );
  recentTransfers.push(...stillPending);

  let namedAccounts: EAccount[];
  if (result.sinceBlockNum === 0) {
    // If resyncing from scratch,  reset named accounts
    namedAccounts = result.namedAccounts;
  } else {
    namedAccounts = addNamedAccounts(
      account.namedAccounts,
      result.namedAccounts
    );
  }

  // Clear pending key rotations
  // If pending rotation was an {add, remove} and slot is {not in, in} result
  // still, its pending
  const stillPendingKeyRotation = account.pendingKeyRotation.filter((r) => {
    const isSlotNotInResult =
      result.accountKeys.find((k) => k.slot === r.slot) == null;
    return r.rotationType === "add" ? isSlotNotInResult : !isSlotNotInResult;
  });

  const ret: Account = {
    ...account,

    lastBalance: BigInt(result.lastBalance),
    lastBlock: result.lastBlock,
    lastBlockTimestamp: result.lastBlockTimestamp,
    lastFinalizedBlock: result.lastFinalizedBlock,

    chainGasConstants: result.chainGasConstants,
    recommendedExchanges: result.recommendedExchanges || [],
    suggestedActions: result.suggestedActions?.filter(
      (a) => !account.dismissedActionIDs.includes(a.id)
    ),

    recentTransfers,
    namedAccounts,
    accountKeys: result.accountKeys || [],
    pendingKeyRotation: stillPendingKeyRotation,
  };

  console.log(
    `[SYNC] synced ${account.name} ${result.address}.\n` +
      JSON.stringify({
        oldBlock: account.lastBlock,
        oldBalance: amountToDollars(account.lastBalance),
        oldTransfers: account.recentTransfers.length,
        newBlock: result.lastBlock,
        newBalance: amountToDollars(BigInt(result.lastBalance)),
        newTransfers: recentTransfers.length,
        nPending: recentTransfers.filter((t) => t.status === "pending").length,
      })
  );
  return ret;
}

export function syncFindSameOp(
  opHash: Hex | undefined,
  ops: (TransferOpEvent | PaymentLinkOpEvent)[]
): TransferOpEvent | PaymentLinkOpEvent | null {
  if (opHash == null) return null;
  return ops.find((r) => opHash === r.opHash) || null;
}

/** Update contacts based on recent interactions */
function addNamedAccounts(old: EAccount[], found: EAccount[]): EAccount[] {
  const ret = [...old];
  const addrs = new Set(old.map((na) => na.addr));

  for (const na of found) {
    if (addrs.has(na.addr)) continue;
    addrs.add(na.addr);
    ret.push(na);
  }

  if (ret.length !== old.length) {
    console.log(`[SYNC] added ${ret.length - old.length} new contacts`);
  }

  return ret;
}

/** Add transfers based on new Transfer event logs */
function addTransfers(
  old: DisplayOpEvent[],
  logs: DisplayOpEvent[],
  daimoChain: DaimoChain
): DisplayOpEvent[] {
  // Start with old, finalized transfers
  const ret = [...old];

  // Sort new logs
  logs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber! - b.blockNumber!;
    return a.logIndex! - b.logIndex!;
  });

  // Add new transfers since previous lastFinalizedBlock
  for (const transfer of logs) {
    ret.push({
      type: "transfer",
      status: OpStatus.confirmed,

      from: transfer.from,
      to: transfer.to,
      amount: Number(transfer.amount),
      nonceMetadata: transfer.nonceMetadata,

      timestamp: guessTimestampFromNum(transfer.blockNumber!, daimoChain),
      txHash: transfer.txHash,
      blockNumber: transfer.blockNumber,
      blockHash: transfer.blockHash,
      logIndex: transfer.logIndex,
      opHash: transfer.opHash,
      feeAmount: transfer.feeAmount,
    });
  }

  return ret;
}
