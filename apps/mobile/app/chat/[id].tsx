import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type AlertButton,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Conversation, CursorPage, Message } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { Colors, Flags, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';
import { chatApi } from '@/services/chatApi';
import { useAuthStore } from '@/stores/authStore';
import { getChatSocket, useChatSocketInstance } from '@/hooks/useSocket';
import type { MessageReadPayload } from '@/hooks/useSocket';
import { pickImage, uploadLocalImage, UploadError, type PickedImage } from '@/services/uploadService';
import { saveImageToGallery } from '@/services/mediaService';

type MessagesPage = CursorPage<Message>;
type PendingMessage = Message & { __pending?: boolean; __failed?: boolean };

// ── Typing indicator ─────────────────────────────────────────────────────────
// How long we wait after the user stops typing before emitting `typing:stop`.
// 2500 ms matches typical chat UX (Telegram, WhatsApp both use ~2–3 s).
const TYPING_IDLE_MS = 2500;

// WhatsApp-style window: a sender can edit or delete-for-everyone only within
// 15 min of sending. Kept in sync with the server (MESSAGE_MUTATION_WINDOW_MS).
const MUTATION_WINDOW_MS = 15 * 60 * 1000;

/** Pull a human-readable message off an axios/UploadError, else a fallback. */
function errMessage(err: unknown, fallback: string): string {
  if (err instanceof UploadError) return err.message;
  const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (typeof axiosMsg === 'string' && axiosMsg) return axiosMsg;
  const msg = (err as Error)?.message;
  return typeof msg === 'string' && msg ? msg : fallback;
}

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
      ratingAvg: 0,
      ratingCount: 0,
    },
    content: args.content,
    mediaUrl: args.mediaUrl ?? null,
    messageType: args.messageType,
    replyToId: null,
    deletedAt: null,
    editedAt: null,
    createdAt: new Date().toISOString(),
    __pending: true,
  };
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  // Reactive singleton socket: re-renders (and re-runs the listener effect)
  // whenever the underlying socket instance is swapped after a reconnect, so we
  // never keep listeners bound to a dead socket.
  const chatSocket = useChatSocketInstance();
  const listRef = useRef<FlatList<PendingMessage>>(null);
  const inputRef = useRef<TextInput>(null);
  // Guards post-await side effects in handleSendPhoto so we never setState or
  // alert after the screen has unmounted.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  // Id of the message currently being edited (composer switches to "edit" mode).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Picked-but-not-yet-sent image awaiting confirmation + optional caption.
  const [preview, setPreview] = useState<PickedImage | null>(null);
  const [caption, setCaption] = useState('');
  // Full-screen image lightbox: the mediaUrl being viewed, or null.
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // ── Read receipts ────────────────────────────────────────────────────────────
  // `peerLastReadAt` tracks how far the peer has read. We seed it from the
  // conversation's membersMeta on load, then update it in real-time from the
  // `message:read` socket event.  A message I sent is "read" when its createdAt
  // <= peerLastReadAt (string ISO comparison is safe because they're both UTC
  // ISO-8601 from the same server clock).
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(null);

  // ── Typing indicator ─────────────────────────────────────────────────────────
  // `peerIsTyping` is true while we're receiving `typing:start` events from the
  // peer for THIS conversation.  It auto-clears when a `typing:stop` arrives or
  // when the peer sends a new message (which implicitly means they stopped typing).
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  // Timer ref for clearing peerIsTyping if `typing:stop` somehow gets lost
  // (e.g. peer disconnects mid-typing). 6 s matches the server-side "stop after
  // no heartbeat" convention used by most chat apps.
  const peerTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timer ref for emitting our own `typing:stop` after idle.
  const myTypingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether we're currently in a "typing" session so we don't spam
  // `typing:start` on every keystroke.
  const myTypingActiveRef = useRef(false);

  const messagesKey = useMemo(() => ['conversation', id, 'messages'] as const, [id]);

  // Fetch *just* the conversation we need. Use the conversations-list cache
  // as `placeholderData` so the header paints instantly when we navigated in
  // from Messages tab; otherwise fall back to a single `GET /conversations/:id`
  // request which is still much cheaper than the full list.
  const conversationQuery = useQuery<Conversation>({
    queryKey: ['conversation', id, 'meta'],
    queryFn: () => chatApi.getConversation(id!),
    enabled: !!id,
    placeholderData: () => {
      const cached = qc.getQueryData<CursorPage<Conversation>>(['conversations']);
      return cached?.items.find((c) => c.id === id);
    },
    staleTime: 60_000,
  });
  const messagesQuery = useQuery<MessagesPage>({
    queryKey: messagesKey,
    queryFn: () => chatApi.listMessages(id!),
    enabled: !!id,
  });

  // Seed peerLastReadAt from the conversation meta once loaded.
  // In a DM there's exactly one peer. For group chats we take the *earliest*
  // (minimum) lastReadAt across ALL non-me members — the most conservative ✓✓
  // threshold, so a message is only "read" once every peer has reached it.
  // A future v2 could show per-avatar read receipts.
  useEffect(() => {
    if (!conversationQuery.data || !me?.id) return;
    const peerReads = (conversationQuery.data.membersMeta ?? [])
      .filter((m) => m.userId !== me.id)
      .map((m) => m.lastReadAt)
      .filter((t): t is string => !!t);
    if (peerReads.length === 0) return;
    const earliest = peerReads.reduce((min, t) => (Date.parse(t) < Date.parse(min) ? t : min));
    setPeerLastReadAt(earliest);
  }, [conversationQuery.data, me?.id]);

  // Mark conversation as read when opened, and once again on focus or whenever
  // the socket instance changes (a reconnect needs the read re-emitted).
  useEffect(() => {
    if (!id) return;
    void chatApi.markRead(id).catch(() => null);
    chatSocket?.emit('message:read', { conversationId: id });
  }, [id, chatSocket]);

  // Live updates: subscribe to socket events and update the cache directly.
  // Without this, the screen relies on the global tab-layout listener which
  // (a) may be detached while this screen is on top of the stack and
  // (b) only invalidates queries — the user sees a flicker of "loading" between
  // sending and the message appearing.
  useEffect(() => {
    if (!id) return;
    const socket = chatSocket;
    if (!socket) return;

    function handleNewMessage(payload: unknown): void {
      const msg = payload as Message | undefined;
      if (!msg || msg.conversationId !== id) return;
      qc.setQueryData<MessagesPage>(messagesKey, (prev) => {
        if (!prev) return { items: [msg], nextCursor: null };
        // Don't let a late message:new resurrect a message we've already
        // tombstoned locally (e.g. delete echo races the original).
        if (prev.items.find((m) => m.id === msg.id)?.deletedAt) return prev;
        // Replace any optimistic message from the same sender with same content
        // so we don't double-display while waiting for server echo.
        const items = prev.items.filter((m) => {
          const pm = m as PendingMessage;
          if (!pm.__pending) return true;
          if (m.sender.id !== msg.sender.id) return true;
          // image optimistic uses a local uri; server echo uses the S3 url — match by type+sender
          if (m.messageType === 'image' && msg.messageType === 'image') return false;
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
        // Peer sent a message — they're no longer typing.
        clearPeerTyping();
      }
    }

    // ── Read receipt listener ────────────────────────────────────────────────
    // When the peer reads the conversation, the server emits `message:read`
    // with their userId and the updated lastReadAt timestamp.  We use it to
    // advance peerLastReadAt so the ✓ → ✓✓ transition happens in real-time
    // without waiting for a conversation refetch.
    function handleMessageRead(payload: MessageReadPayload): void {
      if (payload.conversationId !== id) return;
      // Only update if the reader is NOT the current user (we already know our
      // own read state from the optimistic mark-as-read above).
      if (payload.userId === me?.id) return;
      setPeerLastReadAt((prev) => {
        // Only advance — never regress.  Protects against out-of-order delivery.
        // Compare as epoch millis (not lexicographically) so non-Z timestamps
        // (e.g. with a +HH:MM offset) still order correctly.
        if (!prev || Date.parse(payload.lastReadAt) > Date.parse(prev)) return payload.lastReadAt;
        return prev;
      });
    }

    // ── Edit / delete listeners ──────────────────────────────────────────────
    // Peer (or our other device) edited a message — swap the bubble content.
    function handleMessageUpdated(payload: unknown): void {
      const msg = payload as Message | undefined;
      if (!msg || msg.conversationId !== id) return;
      qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
        prev ? { ...prev, items: prev.items.map((m) => (m.id === msg.id ? msg : m)) } : prev,
      );
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    }

    // A message was deleted for everyone — collapse it into a tombstone.
    function handleMessageDeleted(payload: { conversationId: string; messageId: string }): void {
      if (payload.conversationId !== id) return;
      qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((m) =>
                m.id === payload.messageId
                  ? { ...m, deletedAt: new Date().toISOString(), content: null, mediaUrl: null }
                  : m,
              ),
            }
          : prev,
      );
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    }

    // ── Typing indicator listeners ───────────────────────────────────────────
    function handleTypingStart(payload: { conversationId: string; userId: string }): void {
      if (payload.conversationId !== id) return;
      if (payload.userId === me?.id) return;   // don't show our own echo
      setPeerIsTyping(true);
      // Reset the safety timeout — if typing:stop gets lost we auto-clear.
      if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);
      peerTypingTimeoutRef.current = setTimeout(clearPeerTyping, 6000);
    }

    function handleTypingStop(payload: { conversationId: string; userId: string }): void {
      if (payload.conversationId !== id) return;
      if (payload.userId === me?.id) return;
      clearPeerTyping();
    }

    // socket.io's built-in auto-reconnect reuses the SAME instance and re-fires
    // `connect`. Re-emit our read marker then so the server-side room/read state
    // is restored after a transient drop (a brand-new singleton is handled by
    // this effect re-running on the `chatSocket` dependency change).
    function handleConnect(): void {
      void chatApi.markRead(id!).catch(() => null);
      socket!.emit('message:read', { conversationId: id });
    }

    socket.on('message:new', handleNewMessage);
    socket.on('message:read', handleMessageRead);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);
    socket.on('connect', handleConnect);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('message:read', handleMessageRead);
      socket.off('message:updated', handleMessageUpdated);
      socket.off('message:deleted', handleMessageDeleted);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
      socket.off('connect', handleConnect);
      // Emit typing:stop on unmount so the peer's indicator clears immediately.
      if (myTypingActiveRef.current) {
        socket.emit('typing:stop', { conversationId: id });
        myTypingActiveRef.current = false;
      }
      clearPeerTyping();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me?.id, messagesKey, qc, chatSocket]);

  /** Clear the peer typing indicator and cancel the safety timeout. */
  function clearPeerTyping(): void {
    setPeerIsTyping(false);
    if (peerTypingTimeoutRef.current) {
      clearTimeout(peerTypingTimeoutRef.current);
      peerTypingTimeoutRef.current = null;
    }
  }

  // ── Outgoing typing events ───────────────────────────────────────────────────
  // Called on every draft keystroke.  Emits `typing:start` once (not on every
  // key) and schedules `typing:stop` after TYPING_IDLE_MS of silence.
  const handleDraftChange = useCallback((text: string) => {
    setDraft(text);
    if (!id) return;
    const socket = getChatSocket();
    if (!socket) return;

    if (text.length > 0) {
      // Only emit typing:start when we weren't already in a typing session.
      if (!myTypingActiveRef.current) {
        socket.emit('typing:start', { conversationId: id });
        myTypingActiveRef.current = true;
      }
      // Reset idle timer.
      if (myTypingIdleRef.current) clearTimeout(myTypingIdleRef.current);
      myTypingIdleRef.current = setTimeout(() => {
        socket.emit('typing:stop', { conversationId: id });
        myTypingActiveRef.current = false;
      }, TYPING_IDLE_MS);
    } else {
      // Draft cleared — stop immediately.
      if (myTypingActiveRef.current) {
        if (myTypingIdleRef.current) clearTimeout(myTypingIdleRef.current);
        socket.emit('typing:stop', { conversationId: id });
        myTypingActiveRef.current = false;
      }
    }
  }, [id]);

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

  // ── Edit / delete mutations ───────────────────────────────────────────────
  const editMut = useMutation({
    mutationFn: (vars: { messageId: string; content: string }) =>
      chatApi.editMessage(vars.messageId, vars.content),
    onSuccess: (updated) => {
      qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
        prev ? { ...prev, items: prev.items.map((m) => (m.id === updated.id ? updated : m)) } : prev,
      );
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err: unknown, vars) => {
      // Roll the optimistic edit back by refetching the thread.
      void qc.invalidateQueries({ queryKey: messagesKey });
      Alert.alert('Modification impossible', errMessage(err, 'Réessaie plus tard.'));
      void vars;
    },
  });

  const deleteMut = useMutation({
    mutationFn: (messageId: string) => chatApi.deleteMessage(messageId),
    onMutate: (messageId) => {
      qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((m) =>
                m.id === messageId
                  ? { ...m, deletedAt: new Date().toISOString(), content: null, mediaUrl: null }
                  : m,
              ),
            }
          : prev,
      );
    },
    onError: (err: unknown) => {
      void qc.invalidateQueries({ queryKey: messagesKey });
      Alert.alert('Suppression impossible', errMessage(err, 'Réessaie plus tard.'));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['conversations'] }),
  });

  const conversation = conversationQuery.data;
  const peer = conversation?.members.find((m) => m.id !== me?.id) ?? conversation?.members[0];

  const messages = (messagesQuery.data?.items ?? []) as PendingMessage[];

  // When editing an image's caption, an empty input is valid (clears caption);
  // otherwise the composer needs some text to send.
  const editingMessage = editingId ? messages.find((m) => m.id === editingId) : undefined;
  const canSend = !!draft.trim() || (!!editingId && editingMessage?.messageType === 'image');

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!id || !me) return;

    // Edit mode: PATCH the message instead of creating a new one.
    if (editingId) {
      const eid = editingId;
      const editing = messages.find((m) => m.id === eid);
      const isImageEdit = editing?.messageType === 'image';
      // A text message must keep content; an image caption may be cleared.
      if (!text && !isImageEdit) return;
      setEditingId(null);
      setDraft('');
      qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((m) =>
                m.id === eid
                  ? { ...m, content: text || null, editedAt: new Date().toISOString() }
                  : m,
              ),
            }
          : prev,
      );
      editMut.mutate({ messageId: eid, content: text });
      return;
    }

    if (!text) return;
    setDraft('');

    // Stop typing indicator immediately when sending.
    const socket = getChatSocket();
    if (myTypingActiveRef.current && socket) {
      if (myTypingIdleRef.current) clearTimeout(myTypingIdleRef.current);
      socket.emit('typing:stop', { conversationId: id });
      myTypingActiveRef.current = false;
    }

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
  }, [draft, id, me, editingId, editMut, messages, messagesKey, qc, sendMut]);

  // Tap a failed TEXT bubble to retry it: flip it back to pending and re-send
  // under the same tempId so onSuccess/onError can reconcile it as usual.
  const handleRetry = useCallback(
    (item: PendingMessage) => {
      if (!item.__failed || item.messageType !== 'text' || !item.content) return;
      const content = item.content;
      qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((m) =>
                m.id === item.id
                  ? ({ ...m, __pending: true, __failed: false } as PendingMessage)
                  : m,
              ),
            }
          : prev,
      );
      sendMut.mutate({ content, messageType: 'text', tempId: item.id });
    },
    [messagesKey, qc, sendMut],
  );

  // Step 1: pick an image (resized on-device) but DON'T send yet — open the
  // confirmation sheet so the user can add a caption or cancel.
  const handlePickPhoto = useCallback(async () => {
    try {
      const picked = await pickImage('photo');
      if (!picked) return;
      setCaption('');
      setPreview(picked);
    } catch (err) {
      Alert.alert('Photo', errMessage(err, "Impossible d'ouvrir la galerie."));
    }
  }, []);

  // Step 2: confirm — upload the picked image then send it (with caption).
  const handleSendPhoto = useCallback(async () => {
    if (!preview || !id || !me) return;
    const picked = preview;
    const cap = caption.trim();
    setPreview(null);
    setCaption('');
    setUploading(true);

    // Optimistic bubble using the LOCAL uri so it appears instantly; replaced
    // by the server message (with the S3 url) once the upload + send resolve.
    const optimistic = makeOptimisticMessage({
      conversationId: id,
      content: cap || null,
      mediaUrl: picked.uri,
      messageType: 'image',
      me,
    });
    qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
      prev ? { ...prev, items: [optimistic, ...prev.items] } : { items: [optimistic], nextCursor: null },
    );

    try {
      const url = await uploadLocalImage(picked, 'photo');
      sendMut.mutate({
        content: cap || undefined,
        mediaUrl: url,
        messageType: 'image',
        tempId: optimistic.id,
      });
    } catch (err) {
      if (mountedRef.current) {
        qc.setQueryData<MessagesPage>(messagesKey, (prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((m) =>
                  m.id === optimistic.id
                    ? ({ ...m, __failed: true, __pending: false } as PendingMessage)
                    : m,
                ),
              }
            : prev,
        );
        Alert.alert('Photo non envoyée', errMessage(err, "Échec de l'envoi de la photo."));
      }
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  }, [preview, caption, id, me, messagesKey, qc, sendMut]);

  // Enter edit mode for one of my text messages.
  const startEdit = useCallback((msg: PendingMessage) => {
    setEditingId(msg.id);
    setDraft(msg.content ?? '');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft('');
  }, []);

  // Download an image message to the device gallery (needs a native build).
  const handleDownload = useCallback(async (url: string) => {
    setDownloading(true);
    try {
      await saveImageToGallery(url);
      Alert.alert('Enregistré', 'Image ajoutée à ta galerie.');
    } catch (err) {
      Alert.alert('Téléchargement', errMessage(err, "Impossible d'enregistrer l'image."));
    } finally {
      setDownloading(false);
    }
  }, []);

  // Long-press a message → contextual actions (download / edit / delete).
  const handleLongPress = useCallback(
    (item: PendingMessage) => {
      if (item.deletedAt || item.__pending || item.__failed) return;
      const isMe = item.sender.id === me?.id;
      const isImage = item.messageType === 'image' && !!item.mediaUrl;
      const withinWindow = Date.now() - Date.parse(item.createdAt) < MUTATION_WINDOW_MS;

      const buttons: AlertButton[] = [];
      if (isImage && item.mediaUrl) {
        buttons.push({ text: 'Télécharger', onPress: () => void handleDownload(item.mediaUrl!) });
      }
      // Edit within the 15-min window: text bubbles and image captions alike
      // (editing an image edits its caption).
      if (isMe && withinWindow && (item.messageType === 'text' || item.messageType === 'image')) {
        buttons.push({
          text: isImage ? 'Modifier la légende' : 'Modifier',
          onPress: () => startEdit(item),
        });
      }
      if (isMe && withinWindow) {
        buttons.push({
          text: 'Supprimer pour tous',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Supprimer ce message ?',
              'Il sera supprimé pour tous les participants.',
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Supprimer',
                  style: 'destructive',
                  onPress: () => deleteMut.mutate(item.id),
                },
              ],
            ),
        });
      } else if (isMe && !withinWindow) {
        buttons.push({
          text: 'Modification/suppression expirée (15 min)',
          style: 'cancel',
          onPress: () => undefined,
        });
      }
      buttons.push({ text: 'Annuler', style: 'cancel' });
      if (buttons.length === 1) return; // nothing actionable
      Alert.alert('Message', undefined, buttons);
    },
    [me?.id, handleDownload, startEdit, deleteMut],
  );

  if (!conversation || !peer) {
    return (
      <SafeAreaView style={styles.container}>
        <Loader />
      </SafeAreaView>
    );
  }

  const peerName =
    peer.displayName ?? `${peer.firstName ?? ''} ${peer.lastName ?? ''}`.trim() ?? 'Contact';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Feather name="chevron-left" size={28} color={Colors.brown} />
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
          <Feather name="phone" size={17} color={Colors.brown} />
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
            const deleted = !!item.deletedAt;
            const isImage = !deleted && item.messageType === 'image' && !!item.mediaUrl;
            const pending = (item as PendingMessage).__pending;
            const failed = (item as PendingMessage).__failed;

            // ── Read receipt derivation ──────────────────────────────────────
            // Only shown on my own messages (not on pending/failed ones — we
            // don't have a server timestamp for those yet).
            // "read" = peer's lastReadAt is at or after this message's createdAt.
            // Compare as epoch millis (not lexicographically) so the result is
            // robust to non-Z timestamps with a numeric offset.
            const isRead =
              isMe &&
              !pending &&
              !failed &&
              peerLastReadAt !== null &&
              Date.parse(item.createdAt) <= Date.parse(peerLastReadAt);
            const edited = !deleted && !!item.editedAt;

            return (
              <Pressable
                onPress={() => { if (item.__failed) handleRetry(item); }}
                onLongPress={() => handleLongPress(item)}
                delayLongPress={300}
                style={[styles.msgRow, { justifyContent: isMe ? 'flex-end' : 'flex-start' }]}
              >
                {!isMe && (
                  <Avatar
                    uri={item.sender.avatarUrl}
                    name={item.sender.displayName ?? 'N'}
                    size={30}
                    borderColor={colorForId(item.sender.id)}
                  />
                )}
                {deleted ? (
                  <View style={[styles.bubble, isMe ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {isMe && (
                      <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                    )}
                    <View style={styles.tombstoneRow}>
                      <Feather
                        name="slash"
                        size={13}
                        color={isMe ? 'rgba(255,255,255,0.85)' : Colors.tan500}
                      />
                      <Text style={[styles.tombstone, isMe && { color: 'rgba(255,255,255,0.85)' }]}>
                        Message supprimé
                      </Text>
                    </View>
                  </View>
                ) : isImage ? (
                  <View
                    style={[
                      styles.imageBubble,
                      isMe ? styles.bubbleMineCorners : styles.bubbleTheirsCorners,
                      (pending || failed) && { opacity: failed ? 0.5 : 0.7 },
                    ]}
                  >
                    <Pressable onPress={() => item.mediaUrl && setLightbox(item.mediaUrl)}>
                      <Image
                        source={{ uri: item.mediaUrl! }}
                        style={styles.imageContent}
                        contentFit="cover"
                      />
                    </Pressable>
                    {pending && (
                      <View style={styles.imageOverlay}>
                        <ActivityIndicator color={Colors.white} />
                      </View>
                    )}
                    {item.content ? (
                      <View style={styles.imageCaptionRow}>
                        <Text style={styles.imageCaption}>{item.content}</Text>
                        {isMe && !pending && (
                          <Text style={[styles.readReceipt, isRead && styles.readReceiptRead]}>
                            {isRead ? '✓✓' : '✓'}
                          </Text>
                        )}
                      </View>
                    ) : (
                      isMe &&
                      !pending && (
                        <Text style={styles.imageReadReceipt}>{isRead ? '✓✓' : '✓'}</Text>
                      )
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
                        ⚠️ Echec — touche pour reessayer
                      </Text>
                    )}
                    {/* Edited badge + read receipt. ✓ = delivered; ✓✓ (teal) = read. */}
                    {(edited || (isMe && !pending && !failed)) && (
                      <View style={styles.metaRow}>
                        {edited && (
                          <Text
                            style={[
                              styles.editedTag,
                              isMe ? { color: 'rgba(255,255,255,0.7)' } : { color: Colors.tan400 },
                            ]}
                          >
                            modifié
                          </Text>
                        )}
                        {isMe && !pending && !failed && (
                          <Text style={[styles.readReceipt, isRead && styles.readReceiptRead]}>
                            {isRead ? '✓✓' : '✓'}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            messagesQuery.isLoading ? (
              <Loader style={{ marginTop: Spacing.xl }} />
            ) : (
              <Text style={styles.empty}>Envoie le premier message ✨</Text>
            )
          }
        />

        {/* Typing indicator — shows above the composer when the peer is typing. */}
        {peerIsTyping && (
          <View style={styles.typingRow}>
            <Text style={styles.typingText}>
              {peerName} est en train d'ecrire…
            </Text>
          </View>
        )}

        {/* Edit-mode banner above the composer. */}
        {editingId && (
          <View style={styles.editBanner}>
            <Feather name="edit-2" size={15} color={Colors.orange} />
            <View style={{ flex: 1 }}>
              <Text style={styles.editBannerTitle}>Modification du message</Text>
              <Text style={styles.editBannerHint} numberOfLines={1}>
                {editingMessage?.messageType === 'image'
                  ? 'Modifie la légende puis valide'
                  : 'Modifie le texte puis valide'}
              </Text>
            </View>
            <Pressable onPress={cancelEdit} hitSlop={8}>
              <Feather name="x" size={18} color={Colors.tan500} />
            </Pressable>
          </View>
        )}

        <View style={styles.composer}>
          <Pressable
            style={[styles.photoBtn, (uploading || !!editingId) && { opacity: 0.5 }]}
            hitSlop={8}
            onPress={handlePickPhoto}
            disabled={uploading || !!editingId}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={Colors.tan500} />
            ) : (
              <Feather name="image" size={20} color={Colors.tan600} />
            )}
          </Pressable>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={editingId ? 'Modifier le message…' : 'Message…'}
            placeholderTextColor={Colors.tan400}
            value={draft}
            onChangeText={handleDraftChange}
            multiline
            maxLength={2000}
          />
          <Pressable
            onPress={handleSend}
            style={[styles.sendBtn, !canSend && { opacity: 0.4 }]}
            hitSlop={8}
            disabled={!canSend}
          >
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            <Feather name={editingId ? 'check' : 'send'} size={18} color={Colors.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* ── Image confirmation sheet: preview + caption before sending ────── */}
      <Modal
        visible={!!preview}
        transparent
        animationType="slide"
        onRequestClose={() => setPreview(null)}
      >
        <View style={styles.previewBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
              <View style={styles.previewHeader}>
                <Pressable
                  onPress={() => setPreview(null)}
                  hitSlop={10}
                  style={styles.previewIconBtn}
                >
                  <Feather name="x" size={24} color={Colors.white} />
                </Pressable>
                <Text style={styles.previewTitle}>Envoyer la photo</Text>
                <View style={{ width: 40 }} />
              </View>

              <View style={styles.previewImageWrap}>
                {preview && (
                  <Image
                    source={{ uri: preview.uri }}
                    style={styles.previewImage}
                    contentFit="contain"
                  />
                )}
              </View>

              <View style={styles.previewComposer}>
                <TextInput
                  style={styles.previewCaptionInput}
                  placeholder="Ajouter une légende…"
                  placeholderTextColor={Colors.tan400}
                  value={caption}
                  onChangeText={setCaption}
                  multiline
                  maxLength={2000}
                />
                <Pressable onPress={handleSendPhoto} style={styles.sendBtnLg} hitSlop={8}>
                  <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                  <Feather name="send" size={20} color={Colors.white} />
                </Pressable>
              </View>
            </SafeAreaView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Full-screen image lightbox: enlarge + download ────────────────── */}
      <Modal
        visible={!!lightbox}
        transparent
        animationType="fade"
        onRequestClose={() => setLightbox(null)}
      >
        <View style={styles.lightboxBackdrop}>
          <SafeAreaView style={styles.lightboxTopBar} edges={['top']}>
            <Pressable onPress={() => setLightbox(null)} hitSlop={12} style={styles.lightboxIconBtn}>
              <Feather name="x" size={24} color={Colors.white} />
            </Pressable>
          </SafeAreaView>
          <Pressable style={styles.lightboxImageWrap} onPress={() => setLightbox(null)}>
            {lightbox && (
              <Image source={{ uri: lightbox }} style={styles.lightboxImage} contentFit="contain" />
            )}
          </Pressable>
          <SafeAreaView style={styles.lightboxBottomBar} edges={['bottom']}>
            <Pressable
              onPress={() => lightbox && handleDownload(lightbox)}
              disabled={downloading}
              style={[styles.downloadPill, downloading && { opacity: 0.7 }]}
            >
              {downloading ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Feather name="download" size={18} color={Colors.white} />
              )}
              <Text style={styles.downloadPillText}>
                {downloading ? 'Enregistrement…' : 'Enregistrer'}
              </Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
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
  imageReadReceipt: {
    position: 'absolute',
    bottom: 4,
    right: 6,
    fontSize: 10,
    color: Colors.white,
    fontWeight: '700',
  },
  bubbleText: { fontSize: Typography.sizes.md, color: Colors.brown, lineHeight: 20 },
  bubbleMeta: { fontSize: Typography.sizes.xs, color: Colors.brown, marginTop: 4, opacity: 0.85 },
  // ✓ / ✓✓ read receipt below my message text.
  readReceipt: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'right',
    marginTop: 2,
  },
  // Teal/green tint to distinguish "read" (✓✓) from "sent" (✓).
  readReceiptRead: {
    color: Colors.green,
  },
  // Typing indicator row above the composer.
  typingRow: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 4,
    backgroundColor: Colors.cream,
  },
  typingText: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
    fontStyle: 'italic',
  },
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

  // Tombstone for a deleted message.
  tombstoneRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tombstone: { fontSize: Typography.sizes.sm, color: Colors.tan500, fontStyle: 'italic' },
  // Row holding the "modifié" tag + read receipt under a text bubble.
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 2 },
  editedTag: { fontSize: 10, fontStyle: 'italic' },
  // Caption under an image message.
  imageCaptionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.sm,
  },
  imageCaption: { flex: 1, fontSize: Typography.sizes.sm, color: Colors.brown, lineHeight: 19 },

  // ── Edit banner ──────────────────────────────────────────────────────────
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.tan100,
    borderLeftWidth: 3,
    borderLeftColor: Colors.orange,
  },
  editBannerTitle: { fontSize: Typography.sizes.sm, fontWeight: '700', color: Colors.brown },
  editBannerHint: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 1 },
  editBannerCancel: { fontSize: 18, color: Colors.tan500, fontWeight: '700' },

  // ── Image confirmation sheet ──────────────────────────────────────────────
  previewBackdrop: { flex: 1, backgroundColor: '#0B0B0D' },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  previewIconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  previewTitle: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.white },
  previewImageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  previewImage: { width: '100%', height: '100%' },
  previewComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  previewCaptionInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: Radii.xxl,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm + 4,
    maxHeight: 110,
    fontSize: Typography.sizes.md,
    color: Colors.white,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  // Larger send button used on the dark preview sheet.
  sendBtnLg: {
    width: 46,
    height: 46,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  // ── Lightbox ──────────────────────────────────────────────────────────────
  lightboxBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.97)' },
  lightboxTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  lightboxIconBtn: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  lightboxImageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lightboxImage: { width: '100%', height: '100%' },
  lightboxBottomBar: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
  },
  downloadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  downloadPillText: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
});
