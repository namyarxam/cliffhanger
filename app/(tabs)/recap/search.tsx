// Recap search — the one door into everything not already on the Recap tab.
//
// Every result lands in exactly one state, and the row says which:
//
//   available + tracked    → it's on your Recap tab already (lock state and
//                            season chips live there, not here)
//   available + untracked  → "track to unlock": recaps only unlock as YOU
//                            finish seasons, so the CTA starts tracking and
//                            hands off to the show screen to set progress
//   no recap, scripted     → request it (a vote — fulfilment is curated, and
//                            the copy promises notification, not a timeline)
//   no recap, not scripted → one sentence on why not, no button
//   evaluated + declined   → the recorded reason, no button
//
// All recap surface area stays inside this tab by design — the feature is
// niche-but-high-value, and spreading entry points across the app would give
// it more chrome than its usage earns.

import { useMemo, useState, useCallback, type ReactElement } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { useDebounce } from '@/src/hooks/useDebounce';
import { searchShows } from '@/src/lib/data';
import { addShow, getUserShows } from '@/src/lib/watchlist';
import { qk } from '@/src/lib/queryKeys';
import { silentCatch } from '@/src/lib/errorLog';
import {
  getRecapSearchState,
  recapIneligibleReason,
  requestRecap,
  withdrawRecapRequest,
} from '@/src/lib/recapRequests';
import type { RecapSearchState } from '@/src/lib/recapRequests';
import type { ShowSummary } from '@/src/lib/types';

export default function RecapSearchScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 350);

  const resultsQ = useQuery({
    queryKey: ['recapSearch', debounced],
    queryFn: () => searchShows(debounced),
    enabled: debounced.trim().length > 1,
  });
  const results = resultsQ.data ?? [];

  // One RPC round trip for the whole results page: which of these ids have
  // recaps, which were declined, how many requested, did I request.
  const stateQ = useQuery({
    queryKey: ['recapSearchState', results.map(r => r.id).join(',')],
    queryFn: () => getRecapSearchState(results.map(r => r.id)),
    enabled: results.length > 0 && !!userId,
  });

  const trackedQ = useQuery({
    queryKey: qk.userShows.all(userId),
    queryFn: () => getUserShows(userId!),
    enabled: !!userId,
  });
  const trackedIds = useMemo(
    () => new Set((trackedQ.data ?? []).map(s => s.show_id)),
    [trackedQ.data],
  );

  const refreshStates = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['recapSearchState'] }),
    [queryClient],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.searchBox}>
        <FontAwesome name="search" size={14} color={theme.textDim} />
        <TextInput
          style={styles.input}
          placeholder="Search any show…"
          placeholderTextColor={theme.textFaint}
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <FontAwesome name="times-circle" size={16} color={theme.textDim} />
          </Pressable>
        )}
      </View>

      {resultsQ.isFetching && (
        <ActivityIndicator style={styles.spinner} color={theme.textDim} />
      )}

      {!resultsQ.isFetching && debounced.trim().length > 1 && results.length === 0 && (
        <Text style={styles.emptyText}>Nothing found for “{debounced.trim()}”.</Text>
      )}

      {debounced.trim().length <= 1 && (
        <View style={styles.intro}>
          <Text style={styles.introText}>
            Find a show's recap, or request one. Recaps are hand-crafted — the
            most-requested shows get made first, and we'll notify you when yours
            is ready.
          </Text>
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ResultRow
            show={item}
            state={stateQ.data?.get(item.id) ?? null}
            tracked={trackedIds.has(item.id)}
            userId={userId}
            styles={styles}
            theme={theme}
            onChanged={refreshStates}
            onOpenShow={() => router.push(`/show/${item.id}`)}
            onOpenRecapTab={() => router.push('/recap')}
          />
        )}
      />
    </View>
  );
}

function ResultRow({
  show,
  state,
  tracked,
  userId,
  styles,
  theme,
  onChanged,
  onOpenShow,
  onOpenRecapTab,
}: {
  show: ShowSummary;
  state: RecapSearchState | null;
  tracked: boolean;
  userId: string | undefined;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
  onChanged: () => void;
  onOpenShow: () => void;
  onOpenRecapTab: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const hasRecap = !!state?.slug;
  const ineligible = recapIneligibleReason(show);
  const declined = state?.declinedReason ?? null;

  const act = async (fn: () => Promise<void>) => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      silentCatch('recapSearch:action')(e);
    } finally {
      setBusy(false);
    }
  };

  let body: ReactElement;
  if (hasRecap && tracked) {
    body = (
      <Pressable onPress={onOpenRecapTab} hitSlop={6}>
        <Text style={styles.stateGood}>
          Recap available · through S{state!.throughSeason} — it's on your Recap tab
        </Text>
      </Pressable>
    );
  } else if (hasRecap) {
    body = (
      <View style={styles.actionWrap}>
        <Text style={styles.stateGood}>Recap available · through S{state!.throughSeason}</Text>
        <Text style={styles.stateSub}>
          Recaps unlock as you finish seasons, so they can never spoil you.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          disabled={busy}
          onPress={() =>
            act(async () => {
              await addShow(userId!, show.id, 'currently_watching', show.title, show.image, show.network);
              queryClient.invalidateQueries({ queryKey: qk.userShows.all(userId) });
              queryClient.invalidateQueries({ queryKey: qk.recaps(userId) });
              onOpenShow(); // set progress there; the recap unlocks with it
            })
          }
        >
          <Text style={styles.buttonText}>Track & mark where you are</Text>
        </Pressable>
      </View>
    );
  } else if (declined) {
    body = <Text style={styles.stateDim}>{declined}</Text>;
  } else if (ineligible) {
    body = <Text style={styles.stateDim}>{ineligible}</Text>;
  } else if (state?.requestedByMe) {
    body = (
      <View style={styles.actionWrap}>
        <Text style={styles.stateGood}>
          Requested ✓ — we'll notify you when it's ready
          {state.requests > 1 ? ` · ${state.requests} people want this` : ''}
        </Text>
        <Pressable
          disabled={busy}
          onPress={() => act(() => withdrawRecapRequest(userId!, show.id))}
          hitSlop={6}
        >
          <Text style={styles.withdraw}>Withdraw request</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <View style={styles.actionWrap}>
        {state != null && state.requests > 0 && (
          <Text style={styles.stateSub}>
            {state.requests} {state.requests === 1 ? 'person has' : 'people have'} requested this
          </Text>
        )}
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          disabled={busy || !state}
          onPress={() => act(() => requestRecap(userId!, show))}
        >
          <Text style={styles.buttonText}>Request a recap</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Image source={{ uri: show.image ?? undefined }} style={styles.poster} contentFit="cover" />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {show.title}
          {show.year ? <Text style={styles.rowYear}>  {show.year}</Text> : null}
        </Text>
        {body}
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 4,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: theme.bgCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    input: {
      flex: 1,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: 'DMSans_400Regular',
      color: theme.text,
    },
    spinner: {
      marginTop: 24,
    },
    intro: {
      paddingHorizontal: 20,
      paddingTop: 18,
    },
    introText: {
      fontSize: 13,
      fontFamily: 'DMSans_400Regular',
      color: theme.textDim,
      lineHeight: 19,
    },
    emptyText: {
      textAlign: 'center',
      marginTop: 28,
      fontSize: 14,
      fontFamily: 'DMSans_400Regular',
      color: theme.textDim,
    },
    list: {
      padding: 16,
      gap: 14,
    },
    row: {
      flexDirection: 'row',
      gap: 12,
    },
    poster: {
      width: 52,
      height: 74,
      borderRadius: 8,
      backgroundColor: theme.bgCard,
    },
    rowBody: {
      flex: 1,
      gap: 3,
      justifyContent: 'center',
    },
    rowTitle: {
      fontSize: 15,
      fontFamily: 'DMSans_700Bold',
      color: theme.text,
    },
    rowYear: {
      fontFamily: 'DMSans_400Regular',
      color: theme.textFaint,
      fontSize: 13,
    },
    actionWrap: {
      gap: 6,
      alignItems: 'flex-start',
    },
    stateGood: {
      fontSize: 13,
      fontFamily: 'DMSans_500Medium',
      color: theme.accent,
    },
    stateSub: {
      fontSize: 12,
      fontFamily: 'DMSans_400Regular',
      color: theme.textDim,
    },
    stateDim: {
      fontSize: 13,
      fontFamily: 'DMSans_400Regular',
      color: theme.textDim,
      lineHeight: 18,
    },
    button: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: theme.accentBg,
      borderWidth: 1,
      borderColor: theme.accent,
    },
    buttonPressed: {
      opacity: 0.7,
    },
    buttonText: {
      fontSize: 13,
      fontFamily: 'DMSans_700Bold',
      color: theme.accent,
    },
    withdraw: {
      fontSize: 12,
      fontFamily: 'DMSans_500Medium',
      color: theme.textFaint,
    },
  });
