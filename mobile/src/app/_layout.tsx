import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as NativeSplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAuthStore } from '../store/auth';
import { useIdleLogout } from '../hooks/useIdleLogout';
import AnimatedSplash from '../components/SplashScreen';
import { Colors } from '../constants/theme';

// Hold the native launch splash (brand-blue with the logo) until the in-app
// splash has painted its matching first frame, so the hand-off is seamless.
NativeSplashScreen.preventAutoHideAsync();

// Android runs edge-to-edge by default (SDK 54+): the window extends behind the
// transparent system status bar, so whatever color is set for the native root
// view shows in that top strip. Paint it the brand green so the header band
// reaches the very top edge of the screen (app.json "backgroundColor" handles
// this for standalone builds; the runtime call covers Expo Go too).
void SystemUI.setBackgroundColorAsync(Colors.header);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30000 },
  },
});

export default function RootLayout() {
  const { hydrate } = useAuthStore();
  const recordActivity = useIdleLogout(queryClient);
  // The animated splash renders on top of the navigator and is removed once its
  // exit animation finishes, revealing the login screen (or home when the user
  // is already signed in).
  const [splashVisible, setSplashVisible] = useState(true);
  const finishSplash = useCallback(() => setSplashVisible(false), []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Full-screen touch capture → resets the 3-minute idle logout timer. */}
      <View style={{ flex: 1 }} onTouchStart={recordActivity}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="purchase" />
          <Stack.Screen name="confirm" options={{ presentation: 'modal' }} />
          <Stack.Screen
            name="pin"
            options={{ presentation: 'modal', headerShown: true, title: 'Transaction PIN' }}
          />
          <Stack.Screen name="receipt" />
        </Stack>
        {splashVisible ? <AnimatedSplash onFinish={finishSplash} /> : null}
      </View>
    </QueryClientProvider>
  );
}
