import { useMemo } from "react";
import { View, Text } from "react-native";

import { color, ss } from "./style";

const defaultColor = color.midnight;
const defaultBgColor = color.grayLight;

export function Badge({
  children,
  color,
  bgColor,
}: {
  children: React.ReactNode;
  color?: string;
  bgColor?: string;
}) {
  color = color || defaultColor;
  bgColor = bgColor || defaultBgColor;

  const styleWrap = useMemo(
    () => ({
      backgroundColor: bgColor,
      borderRadius: 4,
      paddingVertical: 2,
      paddingHorizontal: 6,
    }),
    [bgColor]
  );

  const styleText = useMemo(
    () => ({
      ...ss.text.metadata,
      lineHeight: 18,
      color,
    }),
    []
  );

  return (
    <View style={styleWrap}>
      <Text style={styleText}>{children}</Text>
    </View>
  );
}
