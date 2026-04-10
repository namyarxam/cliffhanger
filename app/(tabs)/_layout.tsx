import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs, usePathname } from 'expo-router';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getPendingRequests } from '@/src/lib/friends';
import { getPendingInviteCount } from '@/src/lib/conversations';

const RefreshBadgeContext = createContext<() => void>(() => {});
export const useRefreshBadge = () => useContext(RefreshBadgeContext);

function TabIcon(props: { name: React.ComponentProps<typeof FontAwesome>['name']; color: string }) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const { session } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [chatInviteCount, setChatInviteCount] = useState(0);
  const pathname = usePathname();

  const refreshPending = useCallback(() => {
    if (!session?.user?.id) return;
    getPendingRequests(session.user.id)
      .then(p => setPendingCount(p.length))
      .catch(() => {});
    getPendingInviteCount(session.user.id)
      .then(c => setChatInviteCount(c))
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    refreshPending();
    const interval = setInterval(refreshPending, 30000);
    return () => clearInterval(interval);
  }, [refreshPending]);

  const getActiveTab = useCallback(() => {
    const path = pathname.replace(/^\//, '');

    if (path === '' || path === 'index') return 'index';
    if (path === 'search') return 'search';
    if (path === 'chat') return 'chat';
    if (path === 'profile') return 'profile';

    if (path.startsWith('show/')) return 'index';
    if (path.startsWith('chat/')) return 'chat';
    if (path === 'friends' || path === 'settings' || path.startsWith('user/')) return 'profile';

    return null;
  }, [pathname]);

  const activeTab = getActiveTab();

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
          <View style={styles.tabBar}>
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
      <Tabs.Screen name="user/[id]" options={{ href: null, headerShown: false }} />
    </Tabs>
    </RefreshBadgeContext.Provider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.bg,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingBottom: 28,
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
