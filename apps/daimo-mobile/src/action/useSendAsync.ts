import {
  DisplayOpEvent,
  EAccount,
  OpEvent,
  UserOpHex,
  assert,
  dollarsToAmount,
} from "@daimo/common";
import { daimoChainFromId, daimoEphemeralNotesAddress } from "@daimo/contract";
import { DaimoOpSender, OpSenderCallback } from "@daimo/userop";
import { useCallback, useEffect } from "react";
import { Address, Hex } from "viem";

import { ActHandle, SetActStatus, useActStatus } from "./actStatus";
import { env } from "../logic/env";
import { getWrappedRawSigner } from "../logic/key";
import { NamedError } from "../logic/log";
import { getWrappedPasskeySigner } from "../logic/passkey";
import { Account, getAccountManager, useAccount } from "../model/account";

/** Send a user op, returning the userOpHash. */
type SendOpFn = (opSender: DaimoOpSender) => Promise<Hex>;

/** Default send deadline, in seconds. Determines validUntil for each op. */
export const SEND_DEADLINE_SECS = 120;

/** Send a user op, track status. */
export function useSendAsync({
  dollarsToSend,
  sendFn,
  pendingOp,
  accountTransform,
  passkeyAccount,
}: {
  dollarsToSend: number;
  sendFn: SendOpFn;
  pendingOp?: OpEvent;
  /** Runs on success, before the account is saved */
  accountTransform?: (account: Account, pendingOp: OpEvent) => Account;
  passkeyAccount?: Account;
}): ActHandle {
  const [as, setAS] = useActStatus();

  const [deviceAccount] = useAccount();
  const account = passkeyAccount || deviceAccount;

  const keySlot = account
    ? account.accountKeys.find(
        (keyData) => keyData.pubKey === account.enclavePubKey
      )?.slot
    : undefined;

  const feeDollars = account?.chainGasConstants.estimatedFee || 0;
  const cost = { feeDollars, totalDollars: dollarsToSend + feeDollars };

  const exec = useCallback(async () => {
    assert(
      passkeyAccount !== undefined || keySlot != null,
      "No key slot or passkey"
    );
    assert(account != null, "No account");

    const handle = await sendAsync(
      setAS,
      account,
      keySlot,
      !!passkeyAccount,
      sendFn
    );

    // Add pending op and named accounts to history
    if (pendingOp) {
      pendingOp.opHash = handle as Hex;
      pendingOp.timestamp = Math.floor(Date.now() / 1e3);
      pendingOp.feeAmount = Number(dollarsToAmount(feeDollars));

      if (accountTransform) {
        getAccountManager().transform((a) => accountTransform(a, pendingOp));
      }

      console.log(`[SEND] added pending op ${pendingOp.opHash}`);
    }
  }, [account?.enclaveKeyName, keySlot, sendFn]);

  return { ...as, exec, cost };
}

/** Regular transfer / payment link account transform. Adds pending
 *  transfer to history and merges any new named accounts. */
export function transferAccountTransform(namedAccounts: EAccount[]) {
  return (account: Account, pendingOp: OpEvent): Account => {
    assert(["transfer", "createLink", "claimLink"].includes(pendingOp.type));
    // Filter to new named accounts only
    const findAccount = (addr: Address) =>
      account.namedAccounts.find((a) => a.addr === addr);

    namedAccounts = namedAccounts.filter((a) => findAccount(a.addr) == null);

    return {
      ...account,
      recentTransfers: [
        ...account.recentTransfers,
        pendingOp as DisplayOpEvent,
      ],
      namedAccounts: [...account.namedAccounts, ...namedAccounts],
    };
  };
}

/** Warm the DaimoOpSender cache. */
export function useWarmCache(
  enclaveKeyName?: string,
  address?: Address,
  keySlot?: number,
  chainId?: number
) {
  useEffect(() => {
    if (!enclaveKeyName || !address || !keySlot || !chainId) return;
    loadOpSender({
      enclaveKeyName,
      address,
      keySlot,
      usePasskey: false,
      chainId,
    });
  }, [enclaveKeyName, address, keySlot, chainId]);
}

const accountCache: Map<
  [Address, number | undefined],
  Promise<DaimoOpSender>
> = new Map();

function loadOpSender({
  enclaveKeyName,
  address,
  keySlot,
  usePasskey,
  chainId,
}: {
  enclaveKeyName: string;
  address: Address;
  keySlot: number | undefined;
  usePasskey: boolean;
  chainId: number;
}) {
  assert(
    (keySlot == null) === usePasskey,
    "Key slot and passkey are mutually exclusive"
  );

  let promise = accountCache.get([address, keySlot]);
  if (promise) return promise;

  const daimoChain = daimoChainFromId(chainId);
  const rpcFunc = env(daimoChain).rpcFunc;

  const signer = usePasskey
    ? getWrappedPasskeySigner(daimoChain)
    : getWrappedRawSigner(enclaveKeyName, keySlot!);

  const sender: OpSenderCallback = async (op: UserOpHex) => {
    console.info(`[SEND] sending op ${JSON.stringify(op)}`);
    return rpcFunc.sendUserOp.mutate({ op });
  };

  promise = (async () => {
    console.info(
      `[SEND] loading DaimoOpSender ${address} ${enclaveKeyName} ${keySlot}`
    );

    return await DaimoOpSender.init({
      chainId,
      tokenAddress: env(daimoChain).chainConfig.tokenAddress,
      tokenDecimals: env(daimoChain).chainConfig.tokenDecimals,
      notesAddress: daimoEphemeralNotesAddress,
      accountAddress: address,
      accountSigner: signer,
      opSender: sender,
      deadlineSecs: SEND_DEADLINE_SECS,
    });
  })();
  accountCache.set([address, keySlot], promise);

  return promise;
}

async function sendAsync(
  setAS: SetActStatus,
  account: Account,
  keySlot: number | undefined,
  usePasskey: boolean,
  sendFn: SendOpFn
) {
  try {
    if (keySlot === undefined && !usePasskey)
      throw new Error("No key slot or passkey");

    const { enclaveKeyName, address, homeChainId } = account;

    setAS("loading", "Loading account...");
    const opSender = await loadOpSender({
      enclaveKeyName,
      address,
      keySlot,
      usePasskey,
      chainId: homeChainId,
    });

    setAS("loading", "Signing...");
    const handle = await sendFn(opSender);
    setAS("success", "Accepted");

    return handle;
  } catch (e: any) {
    if (keySlot === undefined) {
      setAS("error", "Device removed from account");
    } else if (
      e instanceof NamedError &&
      ["ExpoEnclaveSign", "ExpoPasskeysCreate", "ExpoPasskeysSign"].includes(
        e.name
      )
    ) {
      setAS("error", e.message);
    } else if (e.message === "Network request failed") {
      setAS("error", "Request failed. Offline?");
    } else {
      setAS("error", "Error sending transaction");
    }
    console.error(`[SEND] error: ${e}`);
    throw e;
  }
}
