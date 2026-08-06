// Recap search — the one door into everything not already on the Recap tab,
// and the filter for what IS. Typing matches your own recap library first
// ("Your recaps", instant and local — the tab list outgrew scanning), with
// TVMaze results below for everything you don't have.
//
// Every TVMaze result lands in exactly one state, and the row says which:
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
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { useDebounce } from '@/src/hooks/useDebounce';
import { searchShows } from '@/src/lib/data';
import { listRecaps } from '@/src/lib/recaps';
import type { RecapListEntry } from '@/src/lib/recaps';
import { addShow, getUserShows } from '@/src/lib/watchlist';
import { qk, invalidateDiscover } from '@/src/lib/queryKeys';
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

  // Results and their recap states arrive as ONE query, each row already
  // paired with its state. They used to be two — TVMaze first, then the
  // state RPC keyed on the returned ids — which gave every new results page
  // a couple of frames where rows rendered with a stale or default
  // affordance ("Track" on a show that needed "Request") before the second
  // fetch landed. Atomic pairs make that window unrepresentable.
  //
  // keepPreviousData holds the old page while the next one is in flight;
  // old rows carry their own old states, so what's on screen is always
  // internally consistent, just momentarily previous.
  const resultsQ = useQuery({
    queryKey: ['recapSearch', debounced],
    queryFn: async () => {
      const shows = await searchShows(debounced);
      const states = userId
        ? await getRecapSearchState(shows.map(s => s.id))
        : new Map<string, RecapSearchState>();
      return shows.map(show => ({ show, state: states.get(show.id) ?? null }));
    },
    enabled: debounced.trim().length > 1,
    placeholderData: keepPreviousData,
  });
  const results = resultsQ.data ?? [];

  const trackedQ = useQuery({
    queryKey: qk.userShows.all(userId),
    queryFn: () => getUserShows(userId!),
    enabled: !!userId,
  });
  const trackedIds = useMemo(
    () => new Set((trackedQ.data ?? []).map(s => s.show_id)),
    [trackedQ.data],
  );

  // Your own recap library, filtered as you type. Same query key as the
  // Recap tab, so this is usually served from cache. Filtered on the RAW
  // query, not the debounced one — local matching is free, and the instant
  // response is what makes it feel like a filter rather than a search.
  const recapsQ = useQuery({
    queryKey: qk.recaps(userId),
    queryFn: listRecaps,
    enabled: !!userId,
  });
  const myRecaps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length <= 1) return [];
    return (recapsQ.data ?? [])
      .filter(e => e.maxSeason >= 1 && e.title.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q) ||
          a.title.localeCompare(b.title),
      );
  }, [recapsQ.data, query]);
  const myRecapIds = useMemo(() => new Set(myRecaps.map(e => e.showId)), [myRecaps]);

  // A show already listed under "Your recaps" doesn't need its TVMaze row —
  // that row's whole state would be "on your Recap tab", one section up.
  const globalResults = useMemo(
    () => results.filter(r => !myRecapIds.has(r.show.id)),
    [results, myRecapIds],
  );

  const refreshStates = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['recapSearch'] }),
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

      {!resultsQ.isFetching &&
        debounced.trim().length > 1 &&
        results.length === 0 &&
        myRecaps.length === 0 && (
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
        data={globalResults}
        keyExtractor={item => item.show.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          myRecaps.length > 0 ? (
            <View style={styles.librarySection}>
              <Text style={styles.sectionHeader}>Your recaps</Text>
              {myRecaps.map(e => (
                <MyRecapRow
                  key={e.slug}
                  entry={e}
                  styles={styles}
                  theme={theme}
                  onOpen={() =>
                    router.push(`/recap/${e.slug}?from=${e.maxSeason}&through=${e.maxSeason}`)
                  }
                />
              ))}
              {globalResults.length > 0 && (
                <Text style={styles.sectionHeader}>Everything else</Text>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ResultRow
            show={item.show}
            state={item.state}
            tracked={trackedIds.has(item.show.id)}
            userId={userId}
            styles={styles}
            theme={theme}
            onChanged={refreshStates}
            onOpenShow={() => router.push(`/show/${item.show.id}`)}
            onOpenRecapTab={() => router.push('/recap')}
          />
        )}
      />
    </View>
  );
}

/**
 * A row from the viewer's own library. Tapping plays the latest finished
 * season directly — the same default as the Recap tab's card hero; earlier
 * seasons keep living behind the card's sheet on the tab.
 */
function MyRecapRow({
  entry,
  styles,
  theme,
  onOpen,
}: {
  entry: RecapListEntry;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
  onOpen: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      onPress={onOpen}
    >
      <Image
        source={{ uri: entry.poster ?? entry.backdrop ?? undefined }}
        style={styles.poster}
        contentFit="cover"
      />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          Recap · through S{entry.maxSeason}
        </Text>
      </View>
      <FontAwesome name="play" size={12} color={theme.accent} />
    </Pressable>
  );
}

/**
 * One search result. Reads as a plain list row: poster, title, one quiet
 * subtitle, and a COMPACT trailing affordance — never a block button, which
 * turned a results page into a wall of pills. Ineligible rows grey out with a
 * small marker instead of explaining themselves inline; tapping one surfaces
 * the reason as an alert for whoever actually wants it.
 */
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
  const blocked = !hasRecap && (declined ?? ineligible);

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

  const track = () =>
    act(async () => {
      await addShow(userId!, show.id, 'currently_watching', show.title, show.image, show.network);
      queryClient.invalidateQueries({ queryKey: qk.userShows.all(userId) });
      queryClient.invalidateQueries({ queryKey: qk.recaps(userId) });
      // Newly tracked — Explore's rails exclude tracked shows.
      invalidateDiscover(queryClient, userId);
      onOpenShow(); // set progress there; the recap unlocks with it
    });

  let subtitle: string | null = null;
  let trailing: ReactElement | null = null;
  let onRowPress: (() => void) | undefined;

  if (blocked) {
    // The reason stays one tap away rather than filling the list.
    onRowPress = () => Alert.alert(show.title, blocked);
    trailing = (
      <View style={styles.trailing}>
        <FontAwesome name="ban" size={12} color={theme.textFaint} />
        <Text style={styles.trailingFaint}>{declined ? 'Not a fit' : 'Unscripted'}</Text>
      </View>
    );
  } else if (hasRecap && tracked) {
    subtitle = `Recap · through S${state!.throughSeason} — on your Recap tab`;
    onRowPress = onOpenRecapTab;
    trailing = <FontAwesome name="chevron-right" size={12} color={theme.textFaint} />;
  } else if (hasRecap) {
    subtitle = `Recap available · through S${state!.throughSeason}`;
    onRowPress = track;
    trailing = (
      <Pressable disabled={busy} onPress={track} hitSlop={10}>
        <Text style={styles.trailingAction}>Track</Text>
      </Pressable>
    );
  } else if (state?.requestedByMe) {
    subtitle = state.requests > 1 ? `${state.requests} people want this` : "We'll notify you when it's ready";
    trailing = (
      <Pressable disabled={busy} onPress={() => act(() => withdrawRecapRequest(userId!, show.id))} hitSlop={10}>
        <View style={styles.trailing}>
          <FontAwesome name="check" size={11} color={theme.textDim} />
          <Text style={styles.trailingDim}>Requested</Text>
        </View>
      </Pressable>
    );
  } else {
    if (state != null && state.requests > 0) {
      subtitle = `${state.requests} ${state.requests === 1 ? 'person wants' : 'people want'} this`;
    }
    trailing = (
      // state === null is now definitive (no recap, no requests) rather than
      // "not loaded yet" — the row and its state arrive together — so the
      // button no longer waits on it.
      <Pressable disabled={busy} onPress={() => act(() => requestRecap(userId!, show))} hitSlop={10}>
        <View style={styles.trailing}>
          <FontAwesome name="plus" size={11} color={theme.accent} />
          <Text style={styles.trailingAction}>Request</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.row, blocked && styles.rowBlocked]}
      onPress={onRowPress}
      disabled={!onRowPress}
    >
      <Image source={{ uri: show.image ?? undefined }} style={styles.poster} contentFit="cover" />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {show.title}
          {show.year ? <Text style={styles.rowYear}>  {show.year}</Text> : null}
        </Text>
        {subtitle != null && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
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
    // Matches the FlatList cell gap so library rows and network rows read as
    // one continuous list with quiet section labels.
    librarySection: {
      gap: 14,
    },
    sectionHeader: {
      fontSize: 11,
      fontFamily: 'DMSans_700Bold',
      color: theme.textFaint,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowBlocked: {
      opacity: 0.45,
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
    rowSubtitle: {
      fontSize: 12,
      fontFamily: 'DMSans_400Regular',
      color: theme.textDim,
    },
    // The trailing accessory: icon + a word, never a block. Sized so a column
    // of results reads as a list with quiet affordances, not a wall of pills.
    trailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    trailingAction: {
      fontSize: 13,
      fontFamily: 'DMSans_700Bold',
      color: theme.accent,
    },
    trailingDim: {
      fontSize: 13,
      fontFamily: 'DMSans_500Medium',
      color: theme.textDim,
    },
    trailingFaint: {
      fontSize: 12,
      fontFamily: 'DMSans_500Medium',
      color: theme.textFaint,
    },
  });
