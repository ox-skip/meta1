import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import { WebView } from "react-native-webview";

const WatermarkIcon = require("../../assets/images/icon.png");

const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.42)";
const PANEL = "rgba(255,253,247,0.065)";
const PANEL_STRONG = "rgba(255,253,247,0.105)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.22)";
const TEAL = "#2DD4BF";
const INK = "#07100D";

function normalizeUrl(input: string) {
  const s = input.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

function hostOf(u: string) {
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return "";
  }
}

export function WatermarkedBrowser({
  initialUrl,
  allowGoogleSearch = true,
  lockToInitialHost = true,
  title = "Website preview",
}: {
  initialUrl: string;
  allowGoogleSearch?: boolean;
  lockToInitialHost?: boolean;
  title?: string;
}) {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  const initial = useMemo(() => normalizeUrl(initialUrl), [initialUrl]);
  const initialHost = useMemo(() => hostOf(initial), [initial]);

  const allowedHosts = useMemo(() => {
    const base = new Set<string>();
    if (initialHost) base.add(initialHost);
    base.add("google.com");
    base.add("www.google.com");
    return Array.from(base);
  }, [initialHost]);

  const injected = `
    (function() {
      try {
        const style = document.createElement('style');
        style.innerHTML = '*{ -webkit-user-select:none !important; user-select:none !important; -webkit-touch-callout:none !important; }';
        document.head.appendChild(style);
        document.addEventListener('contextmenu', function(e){ e.preventDefault(); }, true);
        document.addEventListener('copy', function(e){ e.preventDefault(); }, true);
      } catch (e) {}
    })();
    true;
  `;

  function onSubmitSearch() {
    const next = normalizeUrl(q);
    if (!next) return;
    webRef.current?.stopLoading?.();
    webRef.current?.injectJavaScript?.(`window.location.href = ${JSON.stringify(next)}; true;`);
  }

  function shouldStart(req: any) {
    const url: string = req?.url ?? "";
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (!lockToInitialHost) return true;
    return allowedHosts.includes(hostOf(url));
  }

  return (
    <View
      style={{
        marginTop: 12,
        flex: 1,
        minHeight: 440,
        borderRadius: 22,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: BORDER_TOP,
        backgroundColor: "#050706",
      }}
    >
      <View
        style={{
          padding: 12,
          backgroundColor: "rgba(8,12,10,0.94)",
          borderBottomWidth: 1,
          borderBottomColor: BORDER,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>
              {title}
            </Text>
            <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>Secure preview</Text>
          </View>

          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(45,212,191,0.12)",
              borderWidth: 1,
              borderColor: "rgba(45,212,191,0.32)",
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={TEAL} />
          </View>
        </View>

        {allowGoogleSearch ? (
          <View
            style={{
              marginTop: 10,
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
              borderRadius: 16,
              paddingLeft: 12,
              paddingRight: 6,
              paddingVertical: 6,
              backgroundColor: PANEL,
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            <Ionicons name="search-outline" size={18} color={MUTED} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search or enter website"
              placeholderTextColor={FAINT}
              style={{ flex: 1, minHeight: 38, color: TEXT, fontWeight: "800" }}
              returnKeyType="search"
              onSubmitEditing={onSubmitSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              onPress={onSubmitSearch}
              accessibilityRole="button"
              accessibilityLabel="Open website"
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: TEAL,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <Ionicons name="arrow-forward" size={18} color={INK} />
            </Pressable>
          </View>
        ) : null}

        <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
          <BrowserButton icon="chevron-back" label="Back" disabled={!canBack} onPress={() => webRef.current?.goBack()} />
          <BrowserButton
            icon="chevron-forward"
            label="Forward"
            disabled={!canForward}
            onPress={() => webRef.current?.goForward()}
          />
          <BrowserButton icon="refresh" label="Reload" onPress={() => webRef.current?.reload()} />
        </View>
      </View>

      <View style={{ flex: 1, minHeight: 300, backgroundColor: "#020302" }}>
        <WebView
          ref={webRef}
          source={{ uri: initial }}
          injectedJavaScript={injected}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(st) => {
            setCanBack(!!st.canGoBack);
            setCanForward(!!st.canGoForward);
          }}
          setSupportMultipleWindows={false}
          incognito
          javaScriptEnabled
          domStorageEnabled
          onShouldStartLoadWithRequest={shouldStart}
          originWhitelist={["https://*", "http://*"]}
        />

        {loading ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(2,3,2,0.72)",
            }}
          >
            <ActivityIndicator color={TEAL} />
            <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading preview</Text>
          </View>
        ) : null}

        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" }}
        >
          {Array.from({ length: 9 }).map((_, row) => (
            <View
              key={`wm-browser-row-${row}`}
              style={{
                position: "absolute",
                top: row * 56 - 20,
                left: row % 2 === 0 ? -26 : -86,
                flexDirection: "row",
              }}
            >
              {Array.from({ length: 8 }).map((__, col) => (
                <View
                  key={`wm-browser-cell-${row}-${col}`}
                  style={{
                    width: 140,
                    transform: [{ rotate: "-24deg" }],
                    opacity: 0.15,
                  }}
                >
                  <Text style={{ color: "rgba(255,253,247,0.40)", fontSize: 10, fontWeight: "900" }}>PREVIEW</Text>
                </View>
              ))}
            </View>
          ))}
          <View style={{ position: "absolute", right: 10, bottom: 10, opacity: 0.22 }}>
            <Image source={WatermarkIcon} style={{ width: 34, height: 34 }} />
          </View>
        </View>
      </View>
    </View>
  );
}

function BrowserButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        height: 42,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: disabled ? "rgba(255,253,247,0.035)" : PANEL_STRONG,
        borderWidth: 1,
        borderColor: BORDER,
        opacity: disabled ? 0.48 : 1,
        transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
      })}
    >
      <Ionicons name={icon} size={18} color={disabled ? FAINT : TEXT} />
    </Pressable>
  );
}
