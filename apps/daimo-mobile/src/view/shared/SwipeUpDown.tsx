import BottomSheet, { BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import { BottomSheetDefaultBackdropProps } from "@gorhom/bottom-sheet/lib/typescript/components/bottomSheetBackdrop/types";
import {
  NativeStackNavigationOptions,
  createNativeStackNavigator,
} from "@react-navigation/native-stack";
import {
  ReactNode,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dimensions, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScrollPellet from "./ScrollPellet";
import { color } from "./style";
import useTabBarHeight from "../../common/useTabBarHeight";
import { HistoryOpScreen } from "../screen/HistoryOpScreen";

const Stack = createNativeStackNavigator();
const noHeaders: NativeStackNavigationOptions = {
  headerShown: false,
  animation: "fade_from_bottom",
};

interface SwipeUpDownProps {
  itemMini: ReactNode;
  itemFull: ReactNode;
  swipeHeight: number;
  onShowMini?: () => void;
  onShowFull?: () => void;
  refreshing: boolean;
}

const screenDimensions = Dimensions.get("window");
const SHADOW_OPACITY = 0.2;

export type SwipeUpDownRef = {
  collapse: () => void;
  expand: () => void;
};

export const SwipeUpDown = forwardRef<SwipeUpDownRef, SwipeUpDownProps>(
  (
    { itemMini, itemFull, swipeHeight, onShowMini, onShowFull, refreshing },
    ref
  ) => {
    const ins = useSafeAreaInsets();
    const tabBarHeight = useTabBarHeight();
    const bottomRef = useRef<BottomSheet>(null);

    const maxHeight = screenDimensions.height - ins.top - ins.bottom;
    const posYMini = swipeHeight;
    const posYFull = maxHeight - tabBarHeight;

    const [isMini, setIsMini] = useState(true);

    const animatedIndex = useSharedValue(0);

    useImperativeHandle(ref, () => ({
      collapse() {
        bottomRef.current?.collapse();
      },
      expand() {
        bottomRef.current?.expand();
      },
    }));

    const showFull = () => {
      console.log(`[SWIPE] showFull ${posYFull}`);
      setIsMini(false);
      onShowFull?.();
    };

    const showMini = () => {
      console.log(`[SWIPE] showMini ${posYMini}`);
      setIsMini(true);
      onShowMini?.();
    };

    const snapPoints = useMemo(
      () => [posYMini, posYFull],
      [posYMini, posYFull]
    );

    const renderBackdrop = useCallback(
      (props: BottomSheetDefaultBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={0}
          appearsOnIndex={1}
          pressBehavior="none" // Disable fully closing to swipeIndex -1
        />
      ),
      []
    );

    const handleSheetChanges = (snapIndex: number) => {
      console.log(`[SWIPE] snapIndex ${snapIndex}`);
      if (snapIndex < 1) {
        showMini();
      } else {
        showFull();
      }
    };

    const itemMiniStyle = useAnimatedStyle(() => {
      return {
        opacity: 1 - animatedIndex.value * 3,
      };
    });

    const bottomSheetShadowStyle = useAnimatedStyle(() => {
      return {
        shadowOpacity: SHADOW_OPACITY - animatedIndex.value * SHADOW_OPACITY,
      };
    });

    const TransactionList = () => (
      <>
        <Animated.View
          style={[styles.itemMiniWrapper, itemMiniStyle]}
          pointerEvents={isMini ? "auto" : "none"}
        >
          {itemMini}
        </Animated.View>
        {itemFull}
      </>
    );

    return (
      <BottomSheet
        ref={bottomRef}
        index={0}
        snapPoints={snapPoints}
        handleComponent={ScrollPellet}
        onChange={handleSheetChanges}
        backdropComponent={renderBackdrop}
        animatedIndex={animatedIndex}
        animateOnMount={false}
        enablePanDownToClose={false}
        enableHandlePanningGesture={!refreshing}
        enableContentPanningGesture={!refreshing}
        style={[styles.shadowStyle, bottomSheetShadowStyle]}
      >
        <Stack.Navigator
          initialRouteName="BottomSheetList"
          screenOptions={noHeaders}
        >
          <Stack.Group>
            <Stack.Screen name="BottomSheetList" component={TransactionList} />
            <Stack.Screen
              name="BottomSheetHistoryOp"
              component={HistoryOpScreen}
            />
          </Stack.Group>
        </Stack.Navigator>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  itemMiniWrapper: {
    position: "absolute",
    zIndex: 100,
    width: "100%",
    backgroundColor: color.white,
  },
  shadowStyle: {
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: SHADOW_OPACITY,
    shadowRadius: 6.46,
    elevation: 9,
    borderRadius: 12,
  },
});
