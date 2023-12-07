import { SuggestedAction } from "@daimo/api";
import { daimoChainFromId } from "@daimo/contract";
import Octicons from "@expo/vector-icons/Octicons";
import { TouchableOpacity } from "@gorhom/bottom-sheet";
import { useEffect, useState } from "react";
import { GestureResponderEvent, Linking, StyleSheet, View } from "react-native";
import { PanGestureHandler } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { OctName } from "./InputBig";
import { handleDeepLink, useNav } from "./nav";
import { color } from "./style";
import { TextBody, TextMeta } from "./text";
import { env } from "../../logic/env";
import { getAccountManager, useAccount } from "../../model/account";

const ICON_X_SIZE = 24;

export function SuggestedActionBox({ action }: { action: SuggestedAction }) {
  const nav = useNav();
  const [account] = useAccount();

  // Action to display
  const { icon, title, subtitle } = action;

  // UI state
  const [isVisible, setIsVisible] = useState(true);
  const x = useSharedValue(0);
  const y = useSharedValue(-100);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1);
  const xPosition = useSharedValue({ x: 0, y: 0 });
  const wasCancelled = useSharedValue(false);

  // Track when we do the action or dismiss it.
  const { rpcFunc } = env(daimoChainFromId(account!.homeChainId));

  // Press = do the suggested action.
  const onPress = () => {
    if (account == null) return;
    console.log(`[SUGGESTED] executing ${action.id}: ${action.title}`);

    if (action.url.startsWith("daimo")) {
      handleDeepLink(nav, action.url); // daimo:// direct deeplinks
    } else {
      Linking.openURL(action.url); // https://, mailto://, ...
    }

    rpcFunc.logAction.mutate({
      action: {
        accountName: account.name,
        name: "suggested-action-accept",
        keys: { "suggestion.id": action.id, "suggestion.title": action.title },
      },
    });
  };

  // Dismiss by tapping (x) or swiping
  const onDismiss = () => {
    if (account == null) return;
    console.log(`[SUGGESTED] dismissing ${action.id}: ${action.title}`);

    setIsVisible(false);
    getAccountManager().transform((account) => ({
      ...account,
      dismissedActionIDs: [...account.dismissedActionIDs, action.id],
      suggestedActions:
        account?.suggestedActions?.filter(
          (a: SuggestedAction) => a.id !== action.id
        ) || [],
    }));

    rpcFunc.logAction.mutate({
      action: {
        accountName: account.name,
        name: "suggested-action-dismiss",
        keys: { "suggestion.id": action.id, "suggestion.title": action.title },
      },
    });
  };

  const onPressX = (e?: GestureResponderEvent) => {
    e?.stopPropagation();
    opacity.value = withTiming(0, {}, () => {
      runOnJS(onDismiss)();
    });
  };

  // Fade in/out
  useEffect(() => {
    if (isVisible) {
      y.value = withTiming(0);
      x.value = 0;
      opacity.value = withTiming(1);
    }
  }, [isVisible]);

  const gestureHandler = useAnimatedGestureHandler({
    onStart: (event, ctx: { startX: number; eventCancelled: boolean }) => {
      ctx.eventCancelled = false;
      if (
        event.x > xPosition.value.x &&
        event.x < xPosition.value.x + ICON_X_SIZE &&
        event.y < xPosition.value.y + ICON_X_SIZE &&
        event.y > xPosition.value.y
      ) {
        ctx.eventCancelled = true;
      }
      if (!ctx.eventCancelled) {
        scale.value = withTiming(0.98);
      }
      ctx.startX = x.value;
      wasCancelled.value = false;
    },
    onActive: (event, ctx: { startX: number }) => {
      const offset = ctx.startX + event.translationX;
      const frictionPower = 1 - offset / 300;
      if (offset > 0) {
        opacity.value = 1;
        if (frictionPower > 0.476) {
          x.value = offset * frictionPower;
        }
      } else {
        x.value = offset;
        opacity.value = 1 - Math.min(1, -offset / 200);
      }

      if (x.value < -10 || x.value > 10) {
        wasCancelled.value = true;
      }
    },
    onCancel: () => {
      scale.value = withTiming(1);
      x.value = withSpring(0);
      opacity.value = withTiming(1);
    },
    onFinish: (_, ctx: { eventCancelled: boolean }) => {
      if (!wasCancelled.value && !ctx.eventCancelled) {
        runOnJS(onPress)();
      } else {
        if (x.value < -20) {
          x.value = withSpring(-500, {}, () => {
            y.value = -100;
          });
          opacity.value = withTiming(0);
          runOnJS(onDismiss)();
        } else {
          x.value = withSpring(0);
          opacity.value = withTiming(1);
        }
        scale.value = withTiming(1);
      }
      wasCancelled.value = false;
    },
  });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
      transform: [
        {
          scale: scale.value,
        },
        {
          translateX: x.value,
        },
        {
          translateY: y.value,
        },
      ],
    };
  });

  return (
    <PanGestureHandler onGestureEvent={gestureHandler}>
      <Animated.View style={[styles.animatedWrapper, animatedStyle]}>
        <View style={styles.bubble}>
          <View style={styles.bubbleIcon}>
            {!icon && <TextBody color={color.white}>i</TextBody>}
            {icon && (
              <Octicons name={icon as OctName} size={16} color={color.white} />
            )}
          </View>
          <View style={styles.bubbleText}>
            <TextMeta>{title}</TextMeta>
            <TextMeta color={color.grayDark}>{subtitle}</TextMeta>
          </View>
          <View
            style={styles.bubbleExit}
            onLayout={(e) => {
              xPosition.value = {
                x: e.nativeEvent.layout.x,
                y: e.nativeEvent.layout.y,
              };
            }}
          >
            <TouchableOpacity onPress={onPressX}>
              <Octicons name="x" size={ICON_X_SIZE} color={color.grayDark} />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </PanGestureHandler>
  );
}

const styles = StyleSheet.create({
  animatedWrapper: {
    width: "100%",
    zIndex: 10000,
  },
  bubble: {
    backgroundColor: color.ivoryDark,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 16,
    marginHorizontal: 16,
  },
  bubbleIcon: {
    backgroundColor: color.primary,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: 32,
    height: 32,
    borderRadius: 32,
  },
  bubbleExit: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    height: "100%",
    borderRadius: 32,
    marginRight: 2,
  },
  bubbleText: {
    flex: 1,
    flexDirection: "column",
  },
});
