declare module "expo-linear-gradient" {
  import type { ComponentType } from "react";
  import type { ViewProps } from "react-native";

  export type LinearGradientProps = ViewProps & {
    colors: readonly string[];
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    locations?: readonly number[];
  };

  export const LinearGradient: ComponentType<LinearGradientProps>;
}
