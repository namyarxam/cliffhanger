import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getPendingRequests } from '@/src/lib/friends';

const RefreshBadgeContext = createContext<() => void>(() => {});
export const useRefreshBadge = () => useContext(RefreshBadgeContext);

function TabIcon(props: { name: React.ComponentProps<typeof FontAwesome>['name']; color: string }) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const { session } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPending = useCallback(() => {
    if (!session?.user?.id) return;
    getPendingRequests(session.user.id)
      .then(p => setPendingCount(p.length))
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    refreshPending();
    const interval = setInterval(refreshPending, 30000);
    return () => clearInterval(interval);
  }, [refreshPending]);

  return (
    <RefreshBadgeContext.Provider value={refreshPending}>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textDim,
        tabBarStyle: {
          backgroundColor: theme.bg,
          borderTopColor: theme.border,
          borderTopWidth: 1,
        },
        headerStyle: {
          backgroundColor: theme.bg,
        },
        headerTintColor: theme.text,
        headerTitleStyle: {
          fontFamily: 'DMSans_700Bold',
          fontSize: 17,
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'My Shows',
          tabBarIcon: ({ color }) => <TabIcon name="tv" color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color }) => <TabIcon name="search" color={color} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color }) => <TabIcon name="users" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabIcon name="user" color={color} />,
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: pendingCount > 0 ? styles.badge : undefined,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="friends"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="show/[id]"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="group/[id]"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="group/create"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="user/[id]"
        options={{ href: null, headerShown: false }}
      />
    </Tabs>
    </RefreshBadgeContext.Provider>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: theme.accent,
    fontSize: 11,
    fontWeight: '700',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
  },
});
