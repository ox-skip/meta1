import React, { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { WebView } from "react-native-webview";

import ConfirmPurchase from "@/components/common/confirmpurchase";
import { WALLET_THEME as T } from "@/components/wallet/theme";
import { callFn } from "@/services/functions";
import { requireLocalAuth } from "@/utils/secureAuth";

type PaystackInitResponse = {
  authorization_url: string;
};

export default function FundWallet({ onSuccess }: { onSuccess: () => void }) {
  const [amount, setAmount] = useState("1000");
  const [checkout, setCheckout] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const a = useMemo(() => Number(amount || 0), [amount]);

  async function start() {
    if (!Number.isFinite(a) || a <= 0) throw new Error("Enter a valid amount");

    const auth = await requireLocalAuth("Confirm wallet funding");
    if (!auth.ok) throw new Error(auth.message || "Authentication required");

    const res = await callFn<PaystackInitResponse>("paystack-init", { amount: a });
    if (!res.authorization_url) throw new Error("No checkout URL returned");
    setCheckout(res.authorization_url);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.h}>Fund wallet</Text>
      <Text style={styles.sub}>Top up instantly with Paystack checkout</Text>

      <Text style={styles.label}>Amount (NGN)</Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        style={styles.input}
        placeholder="1000"
        placeholderTextColor="rgba(255,255,255,0.35)"
      />

      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      <Pressable style={[styles.btn, loading ? styles.btnDisabled : null]} onPress={() => setConfirm(true)} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Continue</Text>}
      </Pressable>

      <ConfirmPurchase
        visible={confirm}
        title="Confirm deposit"
        message={`You are about to fund NGN ${(a || 0).toLocaleString()} into your wallet.`}
        confirmText="Proceed"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          setLoading(true);
          setMsg(null);
          try {
            await start();
          } catch (e: any) {
            setMsg(e?.message ?? "Funding failed");
          } finally {
            setLoading(false);
          }
        }}
      />

      <Modal visible={!!checkout} animationType="slide" onRequestClose={() => setCheckout(null)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <View style={styles.webTop}>
            <Pressable
              onPress={() => {
                setCheckout(null);
                onSuccess();
              }}
            >
              <Text style={styles.webClose}>Close</Text>
            </Pressable>
            <Text style={styles.webTitle}>Paystack checkout</Text>
            <View style={{ width: 60 }} />
          </View>

          {checkout ? <WebView source={{ uri: checkout }} /> : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: T.card,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: T.border,
  },
  h: { color: T.text, fontWeight: "900", fontSize: 16 },
  sub: { color: T.textMuted, marginTop: 4, marginBottom: 14, fontSize: 12 },
  label: { color: T.textMuted, fontWeight: "800", marginBottom: 8 },
  input: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: T.cardStrong,
    borderWidth: 1,
    borderColor: T.border,
    color: T.text,
  },
  btn: {
    marginTop: 12,
    backgroundColor: T.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: T.ink, fontWeight: "900" },
  msg: { color: "rgba(255,255,255,0.8)", marginTop: 10 },
  webTop: {
    paddingTop: 50,
    paddingBottom: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0B0F17",
  },
  webClose: { color: T.primary, fontWeight: "900", width: 60 },
  webTitle: { color: "white", fontWeight: "900" },
});
