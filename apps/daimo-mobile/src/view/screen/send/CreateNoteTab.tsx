import {
  DaimoLink,
  OpStatus,
  assert,
  dollarsToAmount,
  formatDaimoLink,
} from "@daimo/common";
import { ephemeralNotesAddress } from "@daimo/contract";
import { DaimoAccount, DaimoNonce, DaimoNonceMetadata } from "@daimo/userop";
import { ReactNode, useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Share,
  ShareAction,
  TextInput,
} from "react-native";
import { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { CancelHeader } from "./CancelHeader";
import { useSendAsync } from "../../../action/useSendAsync";
import { useAccount } from "../../../model/account";
import { ButtonBig } from "../../shared/Button";
import { AmountInput } from "../../shared/Input";
import Spacer from "../../shared/Spacer";
import { useNav } from "../../shared/nav";
import { TextCenter, TextError, TextLight } from "../../shared/text";

/** Creates a Note. User picks amount, then sends message via ShareSheet. */
export function CreateNoteTab({ hide }: { hide: () => void }) {
  const [ephemeralPrivKey] = useState<Hex>(generatePrivateKey);
  const ephemeralOwner = useMemo(
    () => ephemeralPrivKey && privateKeyToAccount(ephemeralPrivKey).address,
    [ephemeralPrivKey]
  );

  const [dollars, setDollars] = useState(0);

  const [account] = useAccount();
  assert(account != null);

  // TODO: load and cache
  // Minor optimization. Approving unconditionally costs a bit more gas.
  const approveFirst = true;

  const nonce = new DaimoNonce(new DaimoNonceMetadata());
  const { status, message, exec } = useSendAsync(
    account.enclaveKeyName,
    async (account: DaimoAccount) => {
      if (ephemeralOwner == null)
        throw new Error("Payment Link key not generated yet");
      return account.createEphemeralNote(
        ephemeralOwner,
        `${dollars}`,
        nonce,
        approveFirst
      );
    },
    {
      type: "transfer",
      status: OpStatus.pending,
      from: account.address,
      to: ephemeralNotesAddress,
      amount: Number(dollarsToAmount(dollars)),
      timestamp: Date.now() / 1e3,
    }
  );

  // TODO: load estimated fees
  const fees = 0.05;
  const totalDollars = dollars + fees;

  const statusMessage = (function (): ReactNode {
    switch (status) {
      case "idle":
        if (dollars === 0) return null;
        return `Total incl. fees $${totalDollars.toFixed(2)}`;
      case "loading":
        return message;
      case "error":
        return <TextError>{message}</TextError>;
      default:
        return null;
    }
  })();

  const amountRef = useRef<TextInput>(null);

  const onCreateNote = useCallback(() => {
    if (amountRef.current) amountRef.current.blur();
    exec();
  }, [exec]);

  const nav = useNav();

  const sendNote = useCallback(async () => {
    if (status !== "success") return;
    if (ephemeralOwner == null) return;

    try {
      const link: DaimoLink = {
        type: "note",
        ephemeralOwner,
        ephemeralPrivateKey: ephemeralPrivKey,
      };
      const url = formatDaimoLink(link);

      let result: ShareAction;
      if (Platform.OS === "android") {
        result = await Share.share({ message: url });
      } else {
        result = await Share.share({ url }); // Default behavior for iOS
      }

      if (result.action === Share.sharedAction) {
        console.log(
          "[APP] Note shared with activity type ",
          result.activityType || "unknown"
        );
        nav.navigate("Home");
      } else if (result.action === Share.dismissedAction) {
        // Only on iOS
        console.log("[APP] Note share reverted");
        // TODO: Suggest revert or retry?
      }
    } catch (error: any) {
      console.error("[APP] Note share error:", error);
    }
  }, [ephemeralOwner, ephemeralPrivKey, status]);

  const button = (function () {
    switch (status) {
      case "idle":
        return (
          <ButtonBig
            type="primary"
            title="Create Payment Link"
            onPress={onCreateNote}
            disabled={dollars === 0}
          />
        );
      case "loading":
        return <ActivityIndicator size="large" />;
      case "success":
        return (
          <ButtonBig
            type="success"
            title="Send Payment Link"
            onPress={sendNote}
          />
        );
      case "error":
        return <ButtonBig type="danger" title="Error" disabled />;
    }
  })();

  return (
    <>
      <CancelHeader hide={hide}>Creating note</CancelHeader>
      <Spacer h={32} />
      <AmountInput
        dollars={dollars}
        onChange={setDollars}
        innerRef={amountRef}
      />
      <Spacer h={32} />
      {button}
      <TextLight>
        <TextCenter>{statusMessage}</TextCenter>
      </TextLight>
    </>
  );
}
