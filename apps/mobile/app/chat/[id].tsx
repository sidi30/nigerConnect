import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Message } from '@nigerconnect/shared-types';
import { chatApi } from '@/services/chatApi';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/stores/authStore';
import { useChatSocket, getChatSocket } from '@/hooks/useSocket';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const page = await chatApi.listMessages(id);
      setMessages(page.items);
      await chatApi.markRead(id).catch(() => null);
    })();
  }, [id]);

  useChatSocket({
    onMessage: (payload) => {
      const msg = payload as Message;
      if (msg.conversationId === id) {
        setMessages((prev) => [msg, ...prev]);
        void chatApi.markRead(id!).catch(() => null);
      }
    },
  });

  function handleSend() {
    if (!draft.trim() || !id) return;
    const socket = getChatSocket();
    if (socket) {
      socket.emit('message:send', { conversationId: id, content: draft.trim() });
    } else {
      void chatApi.sendMessage(id, draft.trim()).catch(() => null);
    }
    setDraft('');
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={15}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Conversation</Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={{ paddingVertical: Spacing.md }}
          renderItem={({ item }) => {
            const mine = item.sender.id === me?.id;
            return (
              <View style={[styles.msgRow, mine && { justifyContent: 'flex-end' }]}>
                {!mine && (
                  <Avatar uri={item.sender.avatarUrl} name={item.sender.displayName} size={32} />
                )}
                <View
                  style={[
                    styles.bubble,
                    mine
                      ? { backgroundColor: Colors.orange, marginLeft: 48 }
                      : { backgroundColor: Colors.white, marginRight: 48 },
                  ]}
                >
                  <Text style={[styles.msgText, mine && { color: Colors.white }]}>
                    {item.content}
                  </Text>
                </View>
              </View>
            );
          }}
        />
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Écris un message..."
            placeholderTextColor={Colors.gray400}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={2000}
          />
          <Pressable style={styles.sendBtn} onPress={handleSend}>
            <Text style={{ color: Colors.white, fontWeight: '700' }}>Envoyer</Text>
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
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
    backgroundColor: Colors.white,
  },
  back: { fontSize: 32, color: Colors.brown, width: 32 },
  headerTitle: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  bubble: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radii.lg, maxWidth: '80%' },
  msgText: { fontSize: Typography.sizes.md, color: Colors.brown },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.gray100,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxHeight: 100,
    fontSize: Typography.sizes.md,
    color: Colors.brown,
  },
  sendBtn: {
    backgroundColor: Colors.orange,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.lg,
  },
});
