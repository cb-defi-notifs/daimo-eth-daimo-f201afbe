import { AddrLabel, EAccount, getAccountName } from "@daimo/common";
import Octicons from "@expo/vector-icons/Octicons";
import { useMemo } from "react";
import { Text, TextStyle, View, ViewStyle } from "react-native";

import { color } from "./style";

export function AccountBubble({
  eAcc,
  size,
  isPending,
  transparent,
}: {
  eAcc: EAccount;
  size: number;
  isPending?: boolean;
  transparent?: boolean;
}) {
  const name = getAccountName(eAcc);

  const fontSize = (function () {
    switch (size) {
      case 64:
        return 24;
      case 50:
        return 20;
      case 36:
        return 14;
      default:
        throw new Error(`Invalid size: ${size}`);
    }
  })();

  const letter = (function () {
    if (name.startsWith("0x")) {
      return "0x";
    } else if (eAcc.label != null) {
      switch (eAcc.label) {
        case AddrLabel.Faucet:
          return (
            <Octicons name="download" size={fontSize} color={color.primary} />
          );
        case AddrLabel.PaymentLink:
          return <Octicons name="link" size={fontSize} color={color.primary} />;
        case AddrLabel.Coinbase:
          return <Octicons name="plus" size={fontSize} color={color.primary} />;
        default:
          return "?";
      }
    } else {
      const codePoint = name.codePointAt(0) || "?".charCodeAt(0);
      return String.fromCodePoint(codePoint).toUpperCase();
    }
  })();

  return (
    <Bubble {...{ size, isPending, transparent, fontSize }}>{letter}</Bubble>
  );
}

export function Bubble({
  size,
  isPending,
  transparent,
  fontSize,
  children,
}: {
  size: number;
  isPending?: boolean;
  transparent?: boolean;
  fontSize: number;
  children: React.ReactNode;
}) {
  const col = isPending ? color.primaryBgLight : color.primary;

  const style: ViewStyle = useMemo(
    () => ({
      width: size - 1,
      height: size - 1,
      borderRadius: 99,
      backgroundColor: transparent ? "transparent" : color.white,
      borderWidth: 1,
      borderColor: col,
      alignItems: "center",
      justifyContent: "center",
    }),
    [size, col]
  );

  const textStyle: TextStyle = useMemo(
    () => ({
      fontSize,
      lineHeight: size - 3,
      fontWeight: "bold",
      textAlign: "center",
      color: col,
    }),
    [size, col]
  );

  return (
    <View style={style}>
      <Text style={textStyle} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}
