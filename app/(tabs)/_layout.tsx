import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, Pressable, StyleSheet, AppState } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs, usePathname } from 'expo-router';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getPendingRequests } from '@/src/lib/friends';
import { getPendingInviteCount } from '@/src/lib/conversations';
import { silentCatch } from '@/src/lib/errorLog';

const RefreshBadgeContext = createContext<() => void>(() => {});
export const useRefreshBadge = () => useContext(RefreshBadgeContext);

function TabIcon(props: { name: React.ComponentProps<typeof FontAwesome>['name']; color: string }) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [chatInviteCount, setChatInviteCount] = useState(0);
  const pathname = usePathname();

  const refreshPending = useCallback(() => {
    if (!session?.user?.id) return;
    getPendingRequests(session.user.id)
      .then(p => setPendingCount(p.length))
      .catch(silentCatch('layout:pendingRequests'));
    getPendingInviteCount(session.user.id)
      .then(c => setChatInviteCount(c))
      .catch(silentCatch('layout:chatInvites'));
  }, [session?.user?.id]);

  // Poll while the app is foreground; pause when backgrounded. iOS suspends
  // JS shortly after backgrounding, but timers can still fire briefly during
  // the transition — those polls hit Supabase, get torn down with status_code:0
  // when the OS yanks the socket, and surface as Sentry noise on resume.
  useEffect(() => {
    if (!session?.user?.id) return;
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval) return;
      refreshPending();
      interval = setInterval(refreshPending, 10000);
    };
    const stop = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      sub.remove();
      stop();
    };
  }, [refreshPending, session?.user?.id]);

  const activeTabRef = useRef<string | null>('index');

  const getActiveTab = useCallback(() => {
    const path = pathname.replace(/^\//, '');

    if (path === '' || path === 'index') return 'index';
    if (path === 'search') return 'search';
    if (path === 'chat') return 'chat';
    if (path === 'profile') return 'profile';

    // show/[id] doesn't force a tab — keep whatever tab was active before
    if (path.startsWith('show/')) return activeTabRef.current;
    if (path.startsWith('chat/')) return 'chat';
    if (path === 'friends' || path === 'settings' || path === 'lists' || path.startsWith('user/') || path.startsWith('lists/')) return 'profile';

    return null;
  }, [pathname]);

  const activeTab = getActiveTab();

  // Track the last real tab for routes like show/[id] that don't belong to a specific tab
  useEffect(() => {
    if (activeTab && !pathname.startsWith('/show/')) {
      activeTabRef.current = activeTab;
    }
  }, [activeTab, pathname]);

  return (
    <RefreshBadgeContext.Provider value={refreshPending}>
    <Tabs
      tabBar={(props) => {
        const tabs = [
          { name: 'index', title: 'My Shows', icon: 'tv' as const },
          { name: 'search', title: 'Search', icon: 'search' as const },
          { name: 'chat', title: 'Chat', icon: 'comments' as const },
          { name: 'profile', title: 'Profile', icon: 'user' as const },
        ];

        return (
          <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            {tabs.map(tab => {
              const isActive = activeTab === tab.name;
              const color = isActive ? theme.accent : theme.textDim;

              return (
                <Pressable
                  key={tab.name}
                  style={styles.tabItem}
                  onPress={() => {
                    const route = props.state.routes.find(r => r.name === tab.name);
                    if (route) {
                      props.navigation.navigate(route.name);
                    }
                  }}
                >
                  <View>
                    <TabIcon name={tab.icon} color={color} />
                    {tab.name === 'profile' && pendingCount > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{pendingCount}</Text>
                      </View>
                    )}
                    {tab.name === 'chat' && chatInviteCount > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{chatInviteCount}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.tabLabel, { color }]}>{tab.title}</Text>
                </Pressable>
              );
            })}
          </View>
        );
      }}
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontFamily: 'DMSans_700Bold', fontSize: 17 },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'My Shows' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="settings" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="friends" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="show/[id]" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="chat/[id]" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="chat/new" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="lists" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="lists/[id]" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="user/[id]" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="dropped" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="watched" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="blocked" options={{ href: null, headerShown: false }} />
    </Tabs>
    </RefreshBadgeContext.Provider>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.bg,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    // paddingBottom set dynamically via insets
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: 10,
    fontFamily: 'DMSans_500Medium',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: theme.accent,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
});
