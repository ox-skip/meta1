import * as Clipboard from "expo-clipboard";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { recordAuthSessionNotification } from "@/services/market/notifications";
import { WALLET_THEME as T } from "@/components/wallet/theme";
import { supabase } from "@/services/supabase";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function ProfileModal({ visible, onClose }: Props) {
  const [uid, setUid] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!visible) return;
      setLoading(true);
      setMsg(null);
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) {
        setUid("");
        setLoading(false);
        return;
      }

      const p = await supabase.from("profiles").select("public_uid").eq("id", userId).maybeSingle();
      setUid(p.data?.public_uid ?? "");
      setLoading(false);
    })();
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.h}>Quick profile</Text>
          <Text style={styles.label}>Your UID (share to receive money)</Text>
          <View style={styles.uidBox}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.uid}>{uid || "-"}</Text>}</View>
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}

          <View style={{ height: 12 }} />

          <Pressable
            style={[styles.btn, styles.btnGhost]}
            onPress={async () => {
              if (!uid) return;
              await Clipboard.setStringAsync(uid);
              setMsg("UID copied");
            }}
          >
            <Text style={styles.btnGhostText}>Copy UID</Text>
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnGhost]}
            onPress={async () => {
              await recordAuthSessionNotification("signed_out").catch(() => undefined);
              await supabase.auth.signOut();
              onClose();
            }}
          >
            <Text style={styles.btnGhostText}>Sign out</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onClose}>
            <Text style={styles.btnPrimaryText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 18 },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#07100D",
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: T.border,
  },
  h: { color: T.text, fontSize: 16, fontWeight: "900" },
  label: { color: T.textMuted, marginTop: 10, fontWeight: "700" },
  uidBox: {
    marginTop: 10,
    padding: 14,
    borderRadius: 8,
    backgroundColor: T.cardStrong,
    borderWidth: 1,
    borderColor: T.border,
  },
  uid: { color: T.text, fontWeight: "900", fontSize: 16, letterSpacing: 0.6 },
  msg: { color: "rgba(255,255,255,0.6)", marginTop: 8, fontSize: 12, textAlign: "center" },
  btn: { marginTop: 10, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  btnGhost: { backgroundColor: T.card, borderWidth: 1, borderColor: T.border },
  btnGhostText: { color: "white", fontWeight: "900" },
  btnPrimary: { backgroundColor: T.primary },
  btnPrimaryText: { color: T.ink, fontWeight: "900" },
});
