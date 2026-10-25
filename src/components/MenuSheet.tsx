import { FontAwesome } from '@expo/vector-icons';
import BottomSheet, {
  BottomSheetBackgroundProps, BottomSheetFlatList, BottomSheetScrollView
} from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { CoupleMember } from '../models/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ReanimatedBlurView = Reanimated.createAnimatedComponent(BlurView);

type Tab = 'gallery' | 'memories' | 'stats' | 'sync';
const TABS: { key: Tab; label: string }[] = [
  { key: 'gallery', label: 'Gallery' },
  { key: 'memories', label: 'Memories' },
  { key: 'stats', label: 'Stats' },
  { key: 'sync', label: 'Sync' },
];

export interface GalleryPhoto {
  id: string;
  url: string;
  dateVisited: number;
  placeId?: string | number;
  notes?: string;
}

interface Props {
  stats: { cities: number; places: number; memories: number; photos: number };
  photos: GalleryPhoto[];
  onThisDayPhotos: GalleryPhoto[];
  placeNameFor: (placeId?: string | number) => string | undefined;
  isLoadingGallery: boolean;
  uid?: string;
  getThumbnailUrl: (url: string) => string;
  onOpenPhoto: (photoId: string) => void;
  onCreateInvite: () => Promise<{ displayCode: string; expiresAt: number }>;
  onLoadMembers: () => Promise<CoupleMember[]>;
  onSignOut: () => void;
  onClose: () => void;
  initialIndex?: 0 | 1;
}

const LiquidGlassBackground: React.FC<BottomSheetBackgroundProps> = ({ style, animatedIndex }) => {
  const solidOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(animatedIndex.value, [0, 0.5, 1], [0, 0.8, 1], Extrapolation.CLAMP),
    backgroundColor: '#141414',
  }));

  return (
    <View style={[style, styles.backgroundWrapper]}>
      <ReanimatedBlurView intensity={90} tint="dark" style={styles.absoluteFill} />
      <Reanimated.View style={[styles.absoluteFill, solidOverlayStyle]} />
    </View>
  );
};

// The burger menu. Two snap points: 35% (stats only) and 90% (tabs + gallery, memories, sync).
// Scrollable content must use the BottomSheet* scrollables so scrolling and the sheet's drag gesture cooperate.
export default function MenuSheet({
  stats, photos, onThisDayPhotos, placeNameFor, isLoadingGallery, uid, getThumbnailUrl,
  onOpenPhoto, onCreateInvite, onLoadMembers, onSignOut, onClose, initialIndex = 0,
}: Props) {
  const sheetRef = useRef<BottomSheet>(null);
  const [expanded, setExpanded] = useState(initialIndex > 0);
  const [tab, setTab] = useState<Tab>('stats');
  const [members, setMembers] = useState<CoupleMember[] | null>(null);
  const [invite, setInvite] = useState<{ displayCode: string; expiresAt: number } | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Do NOT feed this back into BottomSheet's `index` prop: it is reactive and would re-snap the sheet mid-animation.
  const handleTarget = (index: number) => {
    if (index < 0) return;
    setExpanded(index > 0);
    if (index === 0) setTab('stats');
  };

  const activeTab = expanded ? tab : 'stats';
  const today = new Date();

  // Load the couple's members each time the Sync tab is shown.
  useEffect(() => {
    if (activeTab !== 'sync') return;
    let cancelled = false;
    onLoadMembers().then((m) => { if (!cancelled) setMembers(m); }, () => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, [activeTab]);

  const handleCreateInvite = async () => {
    setCreatingInvite(true);
    setInviteError(null);
    try {
      setInvite(await onCreateInvite());
    } catch (e: any) {
      setInviteError(e?.message || 'Could not create an invite. Please try again.');
    } finally {
      setCreatingInvite(false);
    }
  };

  const shareInvite = () => {
    if (!invite) return;
    Share.share({ message: `Join me on Activity Map with this invite code: ${invite.displayCode}
(It works once and expires in 24 hours.)` });
  };

  const renderPhoto = ({ item }: { item: GalleryPhoto }) => (
    <TouchableOpacity style={styles.gridImageContainer} onPress={() => onOpenPhoto(item.id)}>
      <Image source={{ uri: getThumbnailUrl(item.url) }} style={styles.gridImage} resizeMode="cover" />
    </TouchableOpacity>
  );

  const renderMemory = ({ item }: { item: GalleryPhoto }) => {
    const yearsAgo = today.getFullYear() - new Date(item.dateVisited).getFullYear();
    return (
      <TouchableOpacity style={styles.otdCard} onPress={() => onOpenPhoto(item.id)}>
        <Image source={{ uri: getThumbnailUrl(item.url) }} style={styles.otdCardImage} resizeMode="cover" />
        <View style={styles.yearsAgoBadgeLarge}>
          <Text style={styles.yearsAgoTextLarge}>{yearsAgo} {yearsAgo === 1 ? 'Year' : 'Years'} Ago</Text>
        </View>
        <View style={styles.otdCardText}>
          <Text style={styles.otdPlaceName}>{placeNameFor(item.placeId) || 'Unknown Location'}</Text>
          <Text style={styles.otdDate}>{new Date(item.dateVisited).toLocaleDateString()}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={initialIndex}
      snapPoints={['35%', '90%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      backgroundComponent={LiquidGlassBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onAnimate={(_from, to) => handleTarget(to)}
      onChange={handleTarget}
      onClose={onClose}
    >
      <View style={styles.body}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Menu</Text>
          <TouchableOpacity onPress={() => sheetRef.current?.close()} style={styles.circularCloseButtonHeader}>
            <FontAwesome name="times" size={16} color="#ebebf5" />
          </TouchableOpacity>
        </View>

        {expanded && (
          <View style={styles.tabsContainer}>
            {TABS.map(({ key, label }) => (
              <TouchableOpacity key={key} style={[styles.tabButton, tab === key && styles.tabButtonActive]} onPress={() => setTab(key)}>
                <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {activeTab === 'stats' && (
          <BottomSheetScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.statsRow}>
              <View style={styles.statCard}><Text style={styles.statValue}>{stats.cities}</Text><Text style={styles.statLabel}>Cities Visited</Text></View>
              <View style={styles.statCard}><Text style={styles.statValue}>{stats.places}</Text><Text style={styles.statLabel}>Places Saved</Text></View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statCard}><Text style={styles.statValue}>{stats.memories}</Text><Text style={styles.statLabel}>Total Memories</Text></View>
              <View style={styles.statCard}><Text style={styles.statValue}>{stats.photos}</Text><Text style={styles.statLabel}>Photos Taken</Text></View>
            </View>
          </BottomSheetScrollView>
        )}

        {activeTab === 'gallery' && (isLoadingGallery ? (
          <ActivityIndicator color="#fff" style={styles.loader} />
        ) : (
          <BottomSheetFlatList
            data={photos}
            keyExtractor={(item: GalleryPhoto) => item.id}
            numColumns={3}
            renderItem={renderPhoto}
            style={styles.edgeToEdge}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listBottomPadding}
            ListEmptyComponent={<Text style={styles.emptyText}>No photos uploaded yet.</Text>}
          />
        ))}

        {activeTab === 'memories' && (
          <BottomSheetFlatList
            data={onThisDayPhotos}
            keyExtractor={(item: GalleryPhoto) => `otd-${item.id}`}
            renderItem={renderMemory}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listBottomPadding}
            ListHeaderComponent={onThisDayPhotos.length > 0 ? <Text style={styles.onThisDayTitle}>On This Day</Text> : undefined}
            ListEmptyComponent={
              <View style={styles.emptyMemoriesContainer}>
                <FontAwesome name="calendar-times-o" size={40} color="#8e8e93" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>No memories on this exact day in previous years.</Text>
              </View>
            }
          />
        )}

        {activeTab === 'sync' && (
          <BottomSheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listBottomPadding}>
            <Text style={styles.label}>Your couple</Text>
            <View style={styles.codeBox}>
              {members === null ? <ActivityIndicator color="#fff" /> : members.map((m) => (
                <Text key={m.uid} style={styles.memberText}>{m.email ?? 'Account without e-mail'}{m.isMe ? ' (you)' : ''}</Text>
              ))}
            </View>

            {members !== null && members.length < 2 && (
              <View>
                <Text style={styles.settingsSubtitle}>Your partner is not connected yet. Create an invite code and send it to them. It works once and expires after 24 hours.</Text>
                {invite && (
                  <View style={styles.codeBox}>
                    <Text style={styles.label}>Invite code (long press to copy)</Text>
                    <Text style={styles.inviteCode} selectable>{invite.displayCode}</Text>
                    <Text style={styles.inviteExpiry}>Valid until {new Date(invite.expiresAt).toLocaleString()}</Text>
                    <TouchableOpacity style={styles.shareButton} onPress={shareInvite}>
                      <Text style={styles.primaryButtonText}>Share code</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {!!inviteError && <Text style={styles.errorText}>{inviteError}</Text>}
                <TouchableOpacity style={[styles.primarySettingsButton, creatingInvite && styles.buttonDisabled]} onPress={handleCreateInvite} disabled={creatingInvite}>
                  {creatingInvite ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{invite ? 'Create a new code' : 'Create invite code'}</Text>}
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.divider} />
            <TouchableOpacity style={styles.signOutButtonLarge} onPress={onSignOut}>
              <Text style={styles.signOutTextLarge}>Log Out</Text>
            </TouchableOpacity>
          </BottomSheetScrollView>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  backgroundWrapper: { borderRadius: 28, overflow: 'hidden' },
  handleIndicator: { backgroundColor: 'rgba(255, 255, 255, 0.3)', width: 40, height: 5, marginTop: 10 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },

  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 16 },
  sheetTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  circularCloseButtonHeader: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255, 255, 255, 0.15)', alignItems: 'center', justifyContent: 'center' },

  tabsContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 4, marginBottom: 20 },
  tabButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabButtonActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  tabText: { color: '#ebebf5', fontSize: 14, fontWeight: '600', opacity: 0.7 },
  tabTextActive: { color: '#fff', opacity: 1 },

  loader: { marginTop: 40 },
  edgeToEdge: { marginHorizontal: -24 },
  listBottomPadding: { paddingBottom: 40 },
  gridImageContainer: { width: SCREEN_WIDTH / 3, aspectRatio: 1, padding: 1 },
  gridImage: { width: '100%', height: '100%' },

  onThisDayTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  otdCard: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  otdCardImage: { width: '100%', height: 250 },
  otdCardText: { padding: 16 },
  otdPlaceName: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  otdDate: { fontSize: 14, color: '#ebebf5', opacity: 0.8 },
  yearsAgoBadgeLarge: { position: 'absolute', top: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' },
  yearsAgoTextLarge: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  emptyMemoriesContainer: { marginTop: 40, alignItems: 'center' },
  emptyIcon: { marginBottom: 16 },
  emptyText: { textAlign: 'center', color: '#8e8e93', marginTop: 30, fontSize: 16 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16, marginHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  statLabel: { fontSize: 12, color: '#ebebf5', opacity: 0.7, textAlign: 'center', fontWeight: '500' },

  settingsSubtitle: { fontSize: 14, color: '#ebebf5', opacity: 0.8, marginBottom: 20, lineHeight: 20 },
  codeBox: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 14, marginBottom: 20 },
  label: { fontSize: 12, color: '#ebebf5', opacity: 0.6, marginBottom: 6, fontWeight: '600', textTransform: 'uppercase' },
  codeText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  memberText: { fontSize: 16, color: '#fff', paddingVertical: 4 },
  inviteCode: { fontSize: 28, fontWeight: 'bold', color: '#fff', letterSpacing: 2, marginBottom: 6 },
  inviteExpiry: { fontSize: 13, color: '#ebebf5', opacity: 0.6, marginBottom: 14 },
  shareButton: { backgroundColor: '#0a84ff', padding: 14, borderRadius: 12, alignItems: 'center' },
  errorText: { color: '#ff9f0a', fontSize: 14, marginBottom: 12 },
  buttonDisabled: { opacity: 0.6 },
  primarySettingsButton: { backgroundColor: '#0a84ff', padding: 16, borderRadius: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 24 },
  signOutButtonLarge: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 14, alignItems: 'center' },
  signOutTextLarge: { color: '#ff453a', fontSize: 16, fontWeight: 'bold' },
});
