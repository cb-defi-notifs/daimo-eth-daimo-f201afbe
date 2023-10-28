import {
  EAccount,
  assert,
  TransferOpEvent,
  TrackedRequest,
  KeyData,
  ChainGasConstants,
  DaimoLinkNote,
  TrackedNote,
  KeyRotationOpEvent,
} from "@daimo/common";
import { useEffect, useState } from "react";
import { MMKV } from "react-native-mmkv";
import { Address, getAddress, Hex } from "viem";

import { StoredModel } from "./storedModel";
import { cacheEAccounts } from "../view/shared/addr";

/**
 * Singleton account key.
 * Will be a series if/when we support multiple accounts.
 */
export const defaultEnclaveKeyName =
  process.env.DAIMO_APP_VARIANT === "dev" ? "daimo-dev-12" : "daimo-12";

/** Account data stored on device. */
export type Account = {
  /** Local device signing key name */
  enclaveKeyName: string;
  /** Local device signing DER pubkey */
  enclavePubKey: Hex;
  /** Daimo name, registered onchain */
  name: string;
  /** Contract wallet address */
  address: Address;

  /** Home chain where we hold our balance */
  homeChainId: number;
  /** Home ERC-20 token where we hold our balance */
  homeCoinAddress: Address;

  /** Latest sync block number */
  lastBlock: number;
  /** Latest sync time */
  lastBlockTimestamp: number;
  /** Balance as of lastBlock */
  lastBalance: bigint;

  /** The latest finalized block as of the most recent sync. */
  lastFinalizedBlock: number;
  /** Transfers to/from other Daimo accounts & other Ethereum accounts. */
  recentTransfers: TransferOpEvent[];
  /** Requests sent from this account. */
  trackedRequests: TrackedRequest[];
  /** Payment links created by this account, but not yet claimed. */
  pendingNotes: TrackedNote[];
  /** Names for each Daimo account we've interacted with. */
  namedAccounts: EAccount[];
  /** P-256 keys authorised by the Daimo account, in DER format */
  accountKeys: KeyData[];
  /** Pending changes to authorised keys  */
  pendingKeyRotation: KeyRotationOpEvent[];

  /** Current gas and paymaster related constants */
  chainGasConstants: ChainGasConstants;

  /** Local device push token, if permission was granted. */
  pushToken: string | null;
};

export function toEAccount(account: Account): EAccount {
  return { addr: account.address, name: account.name };
}

// Pre-v9 chain gas constants
type ChainGasConstantsV8 = {
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  estimatedFee: number;
  paymasterAddress: Address;
};

interface AccountV8 extends StoredModel {
  storageVersion: 8;

  enclaveKeyName: string;
  enclavePubKey: Hex;
  name: string;
  address: string;

  homeChainId: number;
  homeCoinAddress: Address;

  lastBlock: number;
  lastBlockTimestamp: number;
  lastBalance: string;
  lastFinalizedBlock: number;
  recentTransfers: TransferOpEvent[];
  trackedRequests: TrackedRequest[];
  pendingNotes: DaimoLinkNote[];
  namedAccounts: EAccount[];
  accountKeys: KeyData[];

  chainGasConstants: ChainGasConstantsV8;

  pushToken: string | null;
}

interface AccountV9 extends StoredModel {
  storageVersion: 9;

  enclaveKeyName: string;
  enclavePubKey: Hex;
  name: string;
  address: string;

  homeChainId: number;
  homeCoinAddress: Address;

  lastBlock: number;
  lastBlockTimestamp: number;
  lastBalance: string;
  lastFinalizedBlock: number;
  recentTransfers: TransferOpEvent[];
  trackedRequests: TrackedRequest[];
  pendingNotes: DaimoLinkNote[];
  namedAccounts: EAccount[];
  accountKeys: KeyData[];
  pendingKeyRotation: KeyRotationOpEvent[];

  chainGasConstants: ChainGasConstants;

  pushToken: string | null;
}

/** Loads and saves Daimo account data from storage. Notifies listeners. */
export function getAccountManager(): AccountManager {
  if (_accountManager == null) {
    _accountManager = new AccountManager();
  }
  return _accountManager;
}

let _accountManager: AccountManager | null = null;

/** Loads and saves Daimo account data from storage. Notifies listeners. */
class AccountManager {
  currentAccount: Account | null;
  private mmkv = new MMKV();
  private listeners = new Set<(a: Account | null) => void>();

  constructor() {
    // On first load, load+save to ensure latest serialization version.
    this.currentAccount = parseAccount(this.mmkv.getString("account"));
    this.setCurrentAccount(this.currentAccount);
  }

  addListener(listener: (a: Account | null) => void) {
    this.listeners.add(listener);
  }

  removeListener(listener: (a: Account | null) => void) {
    this.listeners.delete(listener);
  }

  setCurrentAccount = (account: Account | null) => {
    console.log("[ACCOUNT] " + (account ? `save ${account.name}` : "clear"));

    // Cache accounts so that addresses show up with correct display names.
    // Would be cleaner use a listener, but must run first.
    if (account) cacheEAccounts(account.namedAccounts);

    this.currentAccount = account;
    this.mmkv.set("account", serializeAccount(account));
    for (const listener of this.listeners) {
      listener(account);
    }
  };
}

/** Loads Daimo user data from storage, provides callback to write. */
export function useAccount(): [
  Account | null,
  (account: Account | null) => void
] {
  const manager = getAccountManager();

  // State + listeners pattern
  const [accState, setAccState] = useState<Account | null>(
    manager.currentAccount
  );
  useEffect(() => {
    manager.addListener(setAccState);
    return () => manager.removeListener(setAccState);
  }, []);

  return [accState, manager.setCurrentAccount];
}

export function parseAccount(accountJSON?: string): Account | null {
  if (!accountJSON) return null;

  const model = JSON.parse(accountJSON) as StoredModel;

  // Migrations
  // Delete V1-78 testnet accounts. Re-onboard to latest account with paymasters.
  if (model.storageVersion < 8) return null;

  if (model.storageVersion === 8) {
    const a = model as AccountV8;
    return {
      enclaveKeyName: a.enclaveKeyName,
      enclavePubKey: a.enclavePubKey,
      name: a.name,
      address: getAddress(a.address),

      homeChainId: a.homeChainId,
      homeCoinAddress: getAddress(a.homeCoinAddress),

      lastBalance: BigInt(a.lastBalance),
      lastBlock: a.lastBlock,
      lastBlockTimestamp: a.lastBlockTimestamp,
      lastFinalizedBlock: a.lastFinalizedBlock,

      recentTransfers: a.recentTransfers,
      trackedRequests: a.trackedRequests,
      namedAccounts: a.namedAccounts,
      accountKeys: a.accountKeys,
      pendingNotes: a.pendingNotes || [],
      pendingKeyRotation: [],

      chainGasConstants: { ...a.chainGasConstants, preVerificationGas: "0" },

      pushToken: a.pushToken,
    };
  }

  assert(model.storageVersion === 9);
  const a = model as AccountV9;

  const ret = {
    enclaveKeyName: a.enclaveKeyName,
    enclavePubKey: a.enclavePubKey,
    name: a.name,
    address: getAddress(a.address),

    homeChainId: a.homeChainId,
    homeCoinAddress: getAddress(a.homeCoinAddress),

    lastBalance: BigInt(a.lastBalance),
    lastBlock: a.lastBlock,
    lastBlockTimestamp: a.lastBlockTimestamp,
    lastFinalizedBlock: a.lastFinalizedBlock,

    recentTransfers: a.recentTransfers,
    trackedRequests: a.trackedRequests,
    namedAccounts: a.namedAccounts,
    accountKeys: a.accountKeys,
    pendingNotes: a.pendingNotes,
    pendingKeyRotation: a.pendingKeyRotation,

    chainGasConstants: a.chainGasConstants,

    pushToken: a.pushToken,
  };

  return ret;
}

export function serializeAccount(account: Account | null): string {
  if (!account) return "";

  const model: AccountV9 = {
    storageVersion: 9,

    enclaveKeyName: account.enclaveKeyName,
    enclavePubKey: account.enclavePubKey,
    name: account.name,
    address: account.address,

    homeChainId: account.homeChainId,
    homeCoinAddress: account.homeCoinAddress,

    lastBalance: account.lastBalance.toString(),
    lastBlock: account.lastBlock,
    lastBlockTimestamp: account.lastBlockTimestamp,
    lastFinalizedBlock: account.lastFinalizedBlock,

    recentTransfers: account.recentTransfers,
    trackedRequests: account.trackedRequests,
    pendingNotes: account.pendingNotes,
    namedAccounts: account.namedAccounts,
    accountKeys: account.accountKeys,
    pendingKeyRotation: account.pendingKeyRotation,

    chainGasConstants: account.chainGasConstants,

    pushToken: account.pushToken,
  };

  return JSON.stringify(model);
}
