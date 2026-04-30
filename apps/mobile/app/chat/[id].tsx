import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Message } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { Colors, Flags, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';
import { chatApi } from '@/services/chatApi';
import { useAuthStore } from '@/stores/authStore';
import { getChatSocket } from '@/hooks/useSocket';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const listRef = useRef<FlatList<Message>>(null);
  const [draft, setDraft] = useState('');

  const convosQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => chatApi.listConversations(),
  });
  const messagesQuery = useQuery({
    queryKey: ['conversation', id, 'messages'],
    queryFn: () => chatApi.listMessages(id!),
    enabled: !!id,
  });

  const sendMut = useMutation({
    mutationFn: (content: string) => chatApi.sendMessage(id!, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', id, 'messages'] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  useEffect(() => {
    if (id) void chatApi.markRead(id).catch(() => null);
  }, [id]);

  const conversation = convosQuery.data?.items.find((c) => c.id === id);
  const peer = conversation?.members.find((m) => m.id !== me?.id) ?? conversation?.members[0];

  const messages = messagesQuery.data?.items ?? [];

  function handleSend() {
    if (!draft.trim() || !id) return;
    const socket = getChatSocket();
    if (socket && socket.connected) {
      socket.emit('message:send', { conversationId: id, content: draft.trim() });
    } else {
      sendMut.mutate(draft.trim());
    }
    setDraft('');
  }

  if (!conversation || !peer) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.orange} style={{ marginTop: Spacing.xxl }} />
      </SafeAreaView>
    );
  }

  const peerName =
    peer.displayName ?? `${peer.firstName ?? ''} ${peer.lastName ?? ''}`.trim() ?? 'Contact';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push(`/user/${peer.id}`)}
          style={styles.peerHeaderBtn}
          hitSlop={4}
        >
          <Avatar
            uri={peer.avatarUrl}
            name={peerName}
            size={40}
            borderColor={colorForId(peer.id)}
          />
          <View style={{ flex: 1 }}>
            <View style={styles.peerRow}>
              <Text style={styles.peerName} numberOfLines={1}>
                {peerName}
              </Text>
              {peer.identityStatus === 'approved' && <VerifiedBadge size={13} />}
            </View>
            <Text style={styles.peerStatus} numberOfLines={1}>
              {peer.countryCode ? Flags[peer.countryCode] : ''} {peer.city ?? ''}
            </Text>
          </View>
        </Pressable>
        <Pressable style={styles.callBtn} hitSlop={8}>
          <Text style={styles.callIcon}>📞</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <FlatList
          ref={listRef}
          data={messages}
          inverted
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messagesContent}
          renderItem={({ item }) => {
            const isMe = item.sender.id === me?.id;
            return (
              <View style={[styles.msgRow, { justifyContent: isMe ? 'flex-end' : 'flex-start' }]}>
                {!isMe && (
                  <Avatar
                    uri={item.sender.avatarUrl}
                    name={item.sender.displayName ?? 'N'}
                    size={30}
                    borderColor={colorForId(item.sender.id)}
                  />
                )}
                <View style={[styles.bubble, isMe ? styles.bubbleMine : styles.bubbleTheirs]}>
                  {isMe && <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />}
                  <Text style={[styles.bubbleText, isMe && { color: Colors.white }]}>
                    {item.content}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            messagesQuery.isLoading ? (
              <ActivityIndicator color={Colors.orange} style={{ marginTop: Spacing.xl }} />
            ) : (
              <Text style={styles.empty}>Envoie le premier message ✨</Text>
            )
          }
        />

        <View style={styles.composer}>
          <Pressable style={styles.photoBtn} hitSlop={8}>
            <Text style={styles.photoIcon}>📷</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor={Colors.tan400}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={2000}
          />
          <Pressable onPress={handleSend} style={styles.sendBtn} hitSlop={8}>
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            <Text style={styles.sendIcon}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md - 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
    backgroundColor: 'rgba(253,251,247,0.96)',
  },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 24, color: Colors.brown },
  peerHeaderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  peerRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  peerName: { fontSize: Typography.sizes.md + 1, fontWeight: '700', color: Colors.brown },
  peerStatus: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 1 },
  callBtn: {
    width: 34,
    height: 34,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callIcon: { fontSize: 15 },
  messagesContent: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, gap: Spacing.sm },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  bubble: {
    maxWidth: '75%',
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm + 3,
    overflow: 'hidden',
  },
  bubbleMine: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 18,
  },
  bubbleText: { fontSize: Typography.sizes.md, color: Colors.brown, lineHeight: 20 },
  empty: {
    textAlign: 'center',
    color: Colors.tan400,
    fontSize: Typography.sizes.sm,
    marginTop: Spacing.xxl,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.tan200,
  },
  photoBtn: {
    width: 38,
    height: 38,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoIcon: { fontSize: 17 },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.xxl,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm + 2,
    maxHeight: 100,
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    backgroundColor: Colors.white,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sendIcon: { color: Colors.white, fontSize: 16, fontWeight: '700' },
});
