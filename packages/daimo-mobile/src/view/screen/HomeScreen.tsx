import { StyleSheet, Text, View } from "react-native";

import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { useCallback } from "react";
import { useAccount } from "../../logic/account";
import { HomeStackParamList } from "../HomeStack";
import { Button, buttonStyles } from "../shared/Button";
import { Header } from "../shared/Header";
import Spacer from "../shared/Spacer";
import { color, ss } from "../shared/style";
import { TextH1 } from "../shared/text";

export default function HomeScreen() {
  const [account] = useAccount();

  const nav = useNavigation<StackNavigationProp<HomeStackParamList>>();
  const goSend = useCallback(() => nav.navigate("Send"), [nav]);
  const goReceive = useCallback(() => nav.navigate("Receive"), [nav]);

  return (
    <View style={ss.container.outerStretch}>
      <Header />
      <View style={styles.amountAndButtons}>
        <TitleAmount
          symbol="$"
          balance={account.lastBalance}
          decimals={18}
          displayDecimals={2}
        />
        <Spacer h={32} />
        <View style={styles.buttonRow}>
          <Button style={sendRecvButton} title="Send" onPress={goSend} />
          <Button style={sendRecvButton} title="Receive" onPress={goReceive} />
        </View>
      </View>
      <View style={ss.spacer.h32} />
    </View>
  );
}

function TitleAmount({
  symbol,
  balance,
  decimals,
  displayDecimals,
}: {
  symbol: string;
  balance: bigint;
  decimals: number;
  displayDecimals: number;
}) {
  if (!(balance >= 0)) throw new Error("Invalid amount");

  balance = balance / BigInt(10 ** (decimals - displayDecimals));
  const dispStr = balance.toString().padStart(displayDecimals + 1, "0");
  const dollars = dispStr.slice(0, -displayDecimals);
  const cents = dispStr.slice(-displayDecimals);

  return (
    <TextH1>
      <Text style={styles.titleSmall}>{symbol}</Text>
      <Spacer w={4} />
      {dollars}
      <Text style={styles.titleGray}>.{cents}</Text>
    </TextH1>
  );
}

const styles = StyleSheet.create({
  amountAndButtons: {
    width: "100%",
    flexDirection: "column",
    alignItems: "center",
  },
  titleSmall: {
    fontSize: 30,
  },
  titleGray: {
    color: color.gray,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 24,
  },
});

const sendRecvButton = StyleSheet.create({
  button: {
    ...buttonStyles.big.button,
    width: 128,
  },
  title: buttonStyles.big.title,
});
