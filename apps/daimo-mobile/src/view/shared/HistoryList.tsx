import {
  EAccount,
  TransferOpEvent,
  assert,
  canSendTo,
  getAccountName,
  timeAgo,
} from "@daimo/common";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useCallback } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TouchableHighlight,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Address, getAddress } from "viem";

import { AccountBubble } from "./AccountBubble";
import { getAmountText } from "./Amount";
import { PendingDot } from "./PendingDot";
import Spacer from "./Spacer";
import { getCachedEAccount } from "./addr";
import { useNav } from "./nav";
import { color, ss, touchHighlightUnderlay } from "./style";
import { TextBody, TextCenter, TextLight } from "./text";
import { Account } from "../../model/account";

interface HeaderObject {
  isHeader: true;
  id: string;
  month: string;
}
interface TransferRenderObject {
  isHeader: false;
  id: string;
  t: TransferOpEvent;
}

export function HistoryListSwipe({
  account,
  showDate,
  maxToShow,
  otherAcc,
}: {
  account: Account;
  showDate: boolean;
  maxToShow?: number;
  otherAcc?: EAccount;
}) {
  const ins = useSafeAreaInsets();

  // Get relevant transfers in reverse chronological order
  let ops = account.recentTransfers.slice().reverse();
  if (otherAcc != null) {
    const otherAddr = otherAcc.addr;
    ops = ops.filter((t) => t.from === otherAddr || t.to === otherAddr);
  }

  // Link to either the op (zoomed in) or the other account (zoomed out)
  // const linkTo = "op"; // Option to link to AccountPage instead.
  const linkTo = otherAcc == null ? "account" : "op";

  if (ops.length === 0) {
    return (
      <View>
        <Spacer h={16} />
        <TextCenter>
          <TextLight>No transactions yet</TextLight>
        </TextCenter>
      </View>
    );
  }

  const renderRow = (t: TransferOpEvent) => (
    <TransferRow
      key={getTransferId(t)}
      transfer={t}
      address={account.address}
      {...{ linkTo, showDate }}
    />
  );

  // Easy case: show a fixed, small preview list
  if (maxToShow != null) {
    const title =
      otherAcc == null ? "Transaction history" : `Transactions between you`;
    return (
      <View style={styles.historyListBody}>
        <HeaderRow key="h0" title={title} />
        {ops.slice(0, maxToShow).map(renderRow)}
        <View style={styles.transferBorder} />
      </View>
    );
  }

  // Full case: show a scrollable, lazy-loaded FlatList
  const stickyIndices = [] as number[];
  const rows: (TransferRenderObject | HeaderObject)[] = [];

  // Render a HeaderRow for each month, and make it sticky
  let lastMonth = "";
  for (const t of ops) {
    const month = new Date(t.timestamp * 1000).toLocaleString("default", {
      year: "numeric",
      month: "long",
    });
    if (month !== lastMonth) {
      stickyIndices.push(rows.length);
      rows.push({
        isHeader: true,
        month,
        id: month,
      });
      lastMonth = month;
    }
    rows.push({
      isHeader: false,
      id: getTransferId(t),
      t,
    });
  }

  return (
    <BottomSheetFlatList
      ListFooterComponent={() => {
        return <Spacer h={ins.bottom + (Platform.OS === "ios" ? 64 : 128)} />;
      }}
      contentContainerStyle={styles.historyListBody}
      data={rows}
      keyExtractor={({ id }) => id}
      renderItem={({ item }) => {
        if (item.isHeader) {
          return <HeaderRow key={item.month} title={item.month} />;
        }
        return (
          <TransferRow
            transfer={item.t}
            address={account.address}
            showDate
            {...{ linkTo }}
          />
        );
      }}
    />
  );
}

function HeaderRow({ title }: { title: string }) {
  return (
    <View style={styles.rowHeader}>
      <Text style={[ss.text.body, { color: color.gray3 }]}>{title}</Text>
    </View>
  );
}

function TransferRow({
  transfer,
  address,
  linkTo,
  showDate,
}: {
  transfer: TransferOpEvent;
  address: Address;
  linkTo: "op" | "account";
  showDate?: boolean;
}) {
  assert(transfer.amount > 0);
  const from = getAddress(transfer.from);
  const to = getAddress(transfer.to);
  assert([from, to].includes(address));

  const otherAddr = from === address ? to : from;
  const otherAcc = getCachedEAccount(otherAddr);
  const amountDelta = from === address ? -transfer.amount : transfer.amount;

  const nav = useNav();
  const viewOp = useCallback(() => {
    // Workaround: react-navigation typescript types are broken.
    // currentTab is eg "SendNav", is NOT in fact a ParamListTab,
    const currentTab = nav.getState().routes[0].name;
    const newTab = currentTab.startsWith("Send") ? "SendTab" : "HomeTab";
    if (linkTo === "op" || !canSendTo(otherAcc)) {
      nav.navigate(newTab, { screen: "HistoryOp", params: { op: transfer } });
    } else {
      nav.navigate(newTab, { screen: "Account", params: { eAcc: otherAcc } });
    }
  }, [nav, transfer, linkTo, otherAcc]);

  const isPending = transfer.status === "pending";
  const textCol = isPending ? color.gray3 : color.midnight;

  return (
    <View style={styles.transferBorder}>
      <TouchableHighlight
        onPress={viewOp}
        {...touchHighlightUnderlay.subtle}
        style={styles.transferRowWrap}
      >
        <View style={styles.transferRow}>
          <View style={styles.transferOtherAccount}>
            <AccountBubble eAcc={otherAcc} size={36} {...{ isPending }} />
            <TextBody color={textCol}>{getAccountName(otherAcc)}</TextBody>
            {isPending && <PendingDot />}
          </View>
          <TransferAmountDate
            amount={amountDelta}
            timestamp={transfer.timestamp}
            showDate={showDate}
            {...{ isPending }}
          />
        </View>
      </TouchableHighlight>
    </View>
  );
}

function TransferAmountDate({
  amount,
  timestamp,
  showDate,
  isPending,
}: {
  amount: number;
  timestamp: number;
  showDate?: boolean;
  isPending?: boolean;
}) {
  const dollarStr = getAmountText({ amount: BigInt(Math.abs(amount)) });
  const sign = amount < 0 ? "-" : "+";
  const amountColor = amount < 0 ? color.midnight : color.success;

  let timeStr: string;
  if (isPending) {
    timeStr = "Pending";
  } else if (showDate) {
    timeStr = new Date(timestamp * 1000).toLocaleString("default", {
      month: "numeric",
      day: "numeric",
    });
  } else {
    const nowS = Date.now() / 1e3;
    timeStr = timeAgo(timestamp, nowS);
  }

  const textCol = isPending ? color.gray3 : color.midnight;
  const amountCol = isPending ? color.gray3 : amountColor;

  return (
    <View style={styles.transferAmountDate}>
      <Text style={[ss.text.metadata, { color: amountCol }]}>
        {sign} {dollarStr}
      </Text>
      <Text style={[ss.text.metadataLight, { color: textCol }]}>{timeStr}</Text>
    </View>
  );
}

function getTransferId(t: TransferOpEvent): string {
  return `${t.timestamp}-${t.from}-${t.to}-${t.txHash}-${t.opHash}`;
}

const styles = StyleSheet.create({
  historyListBody: {
    paddingHorizontal: 24,
    marginBottom: 48,
  },
  rowHeader: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingTop: 16,
    paddingHorizontal: 2,
    backgroundColor: color.white,
  },
  transferBorder: {
    borderTopWidth: 1,
    borderColor: color.grayLight,
  },
  transferRowWrap: {
    marginHorizontal: -24,
  },
  transferRow: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  transferOtherAccount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  transferAmountDate: {
    flexDirection: "column",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 2,
  },
});
