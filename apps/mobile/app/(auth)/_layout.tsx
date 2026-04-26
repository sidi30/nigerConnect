import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#1A0F0A' } }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" options={{ contentStyle: { backgroundColor: '#FDFBF7' } }} />
      <Stack.Screen name="register" options={{ contentStyle: { backgroundColor: '#FDFBF7' } }} />
      <Stack.Screen
        name="forgot-password"
        options={{ contentStyle: { backgroundColor: '#FDFBF7' } }}
      />
    </Stack>
  );
}
