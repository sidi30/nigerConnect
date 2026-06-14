import { Redirect } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function Index() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Wait until the persisted session is restored before deciding where to land,
  // so an already-logged-in user never sees the auth screen flash. The native
  // splash stays visible during this window (handled in app/_layout.tsx), so
  // returning null here shows the splash, not a blank frame.
  if (!isHydrated) return null;

  return <Redirect href={isAuthenticated ? '/(tabs)' : '/(auth)/welcome'} />;
}
