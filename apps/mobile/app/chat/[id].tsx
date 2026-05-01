import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Message, CursorPage } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { Colors, Flags, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';
import { chatApi } from '@/services/chatApi';
import { useAuthStore } from '@/stores/authStore';
import { getChatSocket } from '@/hooks/useSocket';
import { pickAndUploadImage, UploadError } from '@/services/uploadService';

type MessagesPage = CursorPage<Message>;
type PendingMessage = Message & { __pending?: boolean; __failed?: boolean };

function makeOptimisticMessage(args: {
  conversationId: string;
  content: string | null;
  mediaUrl?: string | null;
  messageType: 'text' | 'image' | 'file';
  me: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    city: string | null;
    countryCode: string | null;
    identityStatus: Message['sender']['identityStatus'];
  };
}): PendingMessage {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: args.conversationId,
    sender: {
      id: args.me.id,
      displayName: args.me.displayName,
      firstName: args.me.firstName,
      lastName: args.me.lastName,
      avatarUrl: args.me.avatarUrl,
      city: args.me.city,
      countryCode: args.me.countryCode,
      identityStatus: args.me.identityStatus,
    },
    content: args.content,
    mediaUrl: args.mediaUrl ?? null,
    messageType: args.messageType,
    replyToId: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    __pending: true,
  };
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const listRef = useRef<FlatList<PendingMessage>>(null);
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);

  const messagesKey = useMemo(() => ['conversation', id, 'messages'] as const, [id]);

  const convosQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => chatApi.listConversations(),
  });
  const messagesQuery = useQuery<MessagesPage>({
    queryKey: messagesKey,
    queryFn: () => chatApi.listMessages(id!),
    enabled: !!id,
  });

  // Mark conversation as read when opened, and once again on focus.
  useEffect(() => {
    if (!id) return;
    void chatApi.markRead(id).catch(() => null);
    const socket = getChatSocket();
    socket?.emit('message:read', { conversationId: id });
  }, [id]);

  // Live updates: subscribe to socket events and update the cache directly.
  // Without this, the screen relies on the global tab-layout listener which
  // (a) may be detached while this screen is on top of the stack and
  // (b) only invalidates queries — the user sees a flicker of "loading" between
  // sending and the message appearing.
  useEffect(() => {
    if (!id) return;
    const socket = getChatSocket();
    if (!socket) return;

    function handleNewMessage(payload: unknown): void {
      const msg = payload as Message | undefined;
      if (!msg || msg.conversationId !== id) return;
      qc.setQueryData<MessagesPage>(messagesKey, (prev) => {
        if (!prev) return { items: [msg], nextCursor: null };
        // Replace any optimistic message from the same sender with same content
        // so we don't double-display while waiting for server echo.
        const items = prev.items.filter((m) => {
          if (!('__pending' in m) || !(m as PendingMessage).__pending) return true;
          if (m.sender.id !== msg.sender.id) return true;
          if (m.content !== msg.content) return true;
          if (m.mediaUrl !== msg.mediaUrl) return true;
          return false;
        });
        if (items.some((m) => m.id === msg.id)) return prev;
        return { ...prev, items: [msg, ...items] };
      });
      // Conversations list (preview, unread, ordering) needs refresh too.
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      // Mark as read since user is actively in the chat.
      if (msg.sender.id !== me?.id) {
        void chatApi.markRead(id).catch(() => null);
        socket?.emit('message:read', { conversationId: id });
      }
    }

    socket.on('message:new', handleNewMessage);
    return () => {
      socket.off('message:new', handleNewMessage);
    };
  }, [id, me?.id, messagesKey, qc]);

  const sendMut = useMutation({
    mutationFn: async (vars: {
      content?: string;
      mediaUrl?: string;
      messageType: 'text' | 'image';
      tempId: string;
    }) => {
      // Always go through REST: socket emit doesn't return the saved row,
      // and we want a single source of truth for replacing the optimistic entry.
      // The server will also broadcast over the socket — the listener above
      // dedupes by content so the message:new echo replaces ours cleanly.
      const sent = await chatApi.sendMessage(id!, vars.content ?? '', {
        messageType: vars.messageType,
        mediaUrl: vars.mediaUrl,
      });
      return { sent, tempId: vars.tempId };
    },
    onSuccess: ({ sent, tempId }) => {
      qc.setQueryData<MessagesPage>(messagesKey, (prev) => {
        if (!prev) return { items: [sent], nextCursor: null };
        if (prev.items.some((m) => m.id === sent.id)) {
          // Already inserted via socket — drop the optimistic entry.
          return { ...prev, items: prev.items.filter((m) => m.id !== tempId) };
        }
        return {
          ...prev,
          items: prev.items.map((m) => (m.id === tempId ? sent : m)),
        };
      });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (_err, vars) => {
      qc.setQueryData<MessagesPage>(messagesKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((m) =>
            m.id === vars.tempId ? ({ ...m, __failed: true, __pending: false } as PendingMessage) : m,
          ),
        };
      });
    },
  });

  const conversation = convosQuery.data?.items.find((c) => c.id === id);
  const peer = conversation?.members.find((m) => m.id !== me?.id) ?? conversation?.members[0];

  const messages = (messagesQuery.data?.items ?? []) as PendingMessage[];

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || !id || !me) return;
    setDraft('');
    const optimistic = makeOptimisticMessage({
      conversationId: id,
      content: text,
      messageType: 'text',
      me,
    });
    qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
      prev ? { ...prev, items: [optimistic, ...prev.items] } : { items: [optimistic], nextCursor: null },
    );
    sendMut.mutate({ content: text, messageType: 'text', tempId: optimistic.id });
  }, [draft, id, me, messagesKey, qc, sendMut]);

  const handleAttachPhoto = useCallback(async () => {
    if (!id || !me) return;
    setUploading(true);
    try {
      const url = await pickAndUploadImage('photo');
      if (!url) return;
      const optimistic = makeOptimisticMessage({
        conversationId: id,
        content: null,
        mediaUrl: url,
        messageType: 'image',
        me,
      });
      qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
        prev ? { ...prev, items: [optimistic, ...prev.items] } : { items: [optimistic], nextCursor: null },
      );
      sendMut.mutate({ mediaUrl: url, messageType: 'image', tempId: optimistic.id });
    } catch (err) {
      const message =
        err instanceof UploadError ? err.message : (err as Error).message ?? "Échec de l'envoi de la photo";
      Alert.alert('Photo non envoyée', message);
    } finally {
      setUploading(false);
    }
  }, [id, me, messagesKey, qc, sendMut]);

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
            const isImage = item.messageType === 'image' && item.mediaUrl;
            const pending = (item as PendingMessage).__pending;
            const failed = (item as PendingMessage).__failed;
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
                {isImage ? (
                  <View
                    style={[
                      styles.imageBubble,
                      isMe ? styles.bubbleMineCorners : styles.bubbleTheirsCorners,
                      (pending || failed) && { opacity: failed ? 0.5 : 0.7 },
                    ]}
                  >
                    <Image
                      source={{ uri: item.mediaUrl! }}
                      style={styles.imageContent}
                      contentFit="cover"
                    />
                    {pending && (
                      <View style={styles.imageOverlay}>
                        <ActivityIndicator color={Colors.white} />
                      </View>
                    )}
                  </View>
                ) : (
                  <View
                    style={[
                      styles.bubble,
                      isMe ? styles.bubbleMine : styles.bubbleTheirs,
                      pending && { opacity: 0.7 },
                      failed && { opacity: 0.5 },
                    ]}
                  >
                    {isMe && <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />}
                    <Text style={[styles.bubbleText, isMe && { color: Colors.white }]}>
                      {item.content}
                    </Text>
                    {failed && (
                      <Text style={[styles.bubbleMeta, isMe && { color: Colors.white }]}>
                        ⚠️ Échec — touche pour réessayer
                      </Text>
                    )}
                  </View>
                )}
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
          <Pressable
            style={[styles.photoBtn, uploading && { opacity: 0.5 }]}
            hitSlop={8}
            onPress={handleAttachPhoto}
            disabled={uploading}
          >
            <Text style={styles.photoIcon}>{uploading ? '⏳' : '📷'}</Text>
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
          <Pressable
            onPress={handleSend}
            style={[styles.sendBtn, !draft.trim() && { opacity: 0.4 }]}
            hitSlop={8}
            disabled={!draft.trim()}
          >
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
  bubbleMineCorners: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
  },
  bubbleTheirsCorners: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 18,
  },
  imageBubble: {
    maxWidth: '70%',
    overflow: 'hidden',
    backgroundColor: Colors.tan100,
  },
  imageContent: { width: 220, height: 220 },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleText: { fontSize: Typography.sizes.md, color: Colors.brown, lineHeight: 20 },
  bubbleMeta: { fontSize: Typography.sizes.xs, color: Colors.brown, marginTop: 4, opacity: 0.85 },
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
