import {
  EAccount,
  formatDaimoLink,
  getAccountName,
  getEAccountStr,
} from "@daimo/common";
import Octicons from "@expo/vector-icons/Octicons";
import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, TouchableHighlight, View } from "react-native";

import Spacer from "./Spacer";
import { color, touchHighlightUnderlay } from "./style";
import { TextH2, TextH3 } from "./text";

/** Displays an EAccount, and lets you copy a Daimo deeplink to it. */
export function AccountCopyLinkButton({
  eAcc,
  size,
  center,
}: {
  eAcc: EAccount;
  size: "h2" | "h3";
  center?: boolean;
}) {
  const acctUrl = formatDaimoLink({
    type: "account",
    account: getEAccountStr(eAcc),
  });
  const [justCopied, setJustCopied] = useState(false);
  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(acctUrl);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 1000);
  }, [acctUrl]);

  // Size
  const Elem = size === "h2" ? TextH2 : TextH3;
  const iconSize = size === "h2" ? 18 : 16;
  const iconStyle = useMemo(() => ({ width: iconSize }), [iconSize]);

  return (
    <TouchableHighlight
      {...touchHighlightUnderlay.subtle}
      style={styles.button}
      hitSlop={16}
      onPress={copy}
    >
      <Elem>
        {center && <Spacer w={iconSize} />}
        {getAccountName(eAcc)}
        <Spacer w={8} />
        <View style={iconStyle}>
          <Octicons
            name={justCopied ? "check" : "copy"}
            color={color.grayDark}
            size={iconSize}
          />
        </View>
      </Elem>
    </TouchableHighlight>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: -8,
    borderRadius: 4,
  },
});
