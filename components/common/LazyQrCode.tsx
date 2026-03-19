import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

type QrCodeProps = {
  size?: number;
  value: string;
};

type QrCodeComponent = React.ComponentType<QrCodeProps>;

export default function LazyQrCode({ size = 176, value }: QrCodeProps) {
  const [QrCode, setQrCode] = useState<QrCodeComponent | null>(null);

  useEffect(() => {
    let mounted = true;

    try {
      const mod = require("react-native-qrcode-svg");
      const NextQrCode = (mod?.default ?? mod) as QrCodeComponent;
      if (mounted) {
        setQrCode(() => NextQrCode);
      }
    } catch (error) {
      console.warn("[qr] failed to load react-native-qrcode-svg:", error);
    }

    return () => {
      mounted = false;
    };
  }, []);

  if (!QrCode) {
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return <QrCode value={value} size={size} />;
}
