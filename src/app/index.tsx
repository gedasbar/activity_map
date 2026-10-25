import { FontAwesome } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image, Keyboard,
  KeyboardAvoidingView, Modal,
  PanResponder,
  Platform,
  Pressable,
  Animated as RNAnimated,
  StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';

import { GestureHandlerRootView } from 'react-native-gesture-handler';

import CityDetailSheet from '../components/CityDetailSheet';
import LinkAccountScreen from '../components/LinkAccountScreen';
import MenuSheet from '../components/MenuSheet';
import LoginScreen from '../components/LoginScreen';
import { auth } from '../config/firebaseConfig';
import {
  deleteUnlockedCity, getAllCoupleMemories, getAllSavedPlaces,
  getUnlockedCities, getUserProfile, linkCoupleAccounts, savePlace, unlockCity
} from '../services/firestoreService';
import { isAbortError, searchCities, searchPlaces } from '../services/geocoding';

export interface City {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LITHUANIA_REGION = { latitude: 55.1694, longitude: 23.8813, latitudeDelta: 3.2, longitudeDelta: 4.8 };
const ZOOM_THRESHOLD = 0.15;
const SEARCH_DEBOUNCE_MS = 700; // Nominatim allows about 1 request per second

const normalizeText = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const getThumbnailUrl = (url: string) => {
  if (url && url.includes('/upload/')) {
    return url.replace('/upload/', '/upload/c_fill,w_300,h_300,q_auto/');
  }
  return url;
};

const AnimatedBlurView = RNAnimated.createAnimatedComponent(BlurView);

const FullScreenImageItem = ({ item, placeName }: { item: any, placeName: string }) => {
  const [isImageLoading, setIsImageLoading] = useState(true);

  return (
    <View style={styles.fullScreenItemContainer}>
      {isImageLoading && <ActivityIndicator size="large" color="#0a84ff" style={styles.fullScreenLoader} />}
      <Image source={{ uri: item.url }} style={styles.fullScreenImage} resizeMode="contain" onLoadEnd={() => setIsImageLoading(false)} />
      <View style={styles.fullScreenDetails}>
        <Text style={styles.fullScreenPlaceName}>{placeName}</Text>
        <Text style={styles.fullScreenDate}>{new Date(item.dateVisited).toLocaleDateString()}</Text>
      </View>
    </View>
  );
};

export default function App() {
  const mapRef = useRef<MapView>(null);
  const fullScreenListRef = useRef<FlatList>(null);

  const [mapMode, setMapMode] = useState<'default' | 'city_menu' | 'view_places' | 'search_place'>('default');
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [unlockedCities, setUnlockedCities] = useState<City[]>([]);
  const [savedMapPlaces, setSavedMapPlaces] = useState<any[]>([]);
  const [showAddCityModal, setShowAddCityModal] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const [citySearchResults, setCitySearchResults] = useState<City[]>([]);
  const [isSearchingCity, setIsSearchingCity] = useState(false);
  const [citySearchError, setCitySearchError] = useState<string | null>(null);

  const citySearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const citySearchAbortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [galleryMemories, setGalleryMemories] = useState<any[]>([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(false);
  const [expandedGalleryIndex, setExpandedGalleryIndex] = useState<number | null>(null);

  const [showPlaces, setShowPlaces] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [previewPlace, setPreviewPlace] = useState<any>(null);
  const [customPlaceName, setCustomPlaceName] = useState('');

  const [user, setUser] = useState<User | null>(null);
  const [hasLinkedAccount, setHasLinkedAccount] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [myCoupleId, setMyCoupleId] = useState<string>('');

  const settingsSlideAnim = useRef(new RNAnimated.Value(0)).current;
  const addCitySlideAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (showSettingsModal) settingsSlideAnim.setValue(0);
  }, [showSettingsModal]);

  useEffect(() => {
    if (showAddCityModal) addCitySlideAnim.setValue(0);
  }, [showAddCityModal]);

  const createDynamicSwipe = (animValue: RNAnimated.Value, onClose: () => void) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) animValue.setValue(gestureState.dy);
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 100 || gestureState.vy > 0.8) {
        RNAnimated.timing(animValue, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start(() => onClose());
      } else {
        RNAnimated.spring(animValue, { toValue: 0, useNativeDriver: true }).start();
      }
    }
  });

  const settingsPanResponder = useMemo(() => createDynamicSwipe(settingsSlideAnim, () => setShowSettingsModal(false)), []);
  const addCityPanResponder = useMemo(() => createDynamicSwipe(addCitySlideAnim, () => {
    setShowAddCityModal(false); setCitySearchQuery(''); setCitySearchResults([]); setCitySearchError(null);
  }), []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setLoading(true);
        setUser(currentUser);
        try {
          const profile = await getUserProfile(currentUser.uid);
          if (profile?.coupleId) {
            setHasLinkedAccount(true);
            setMyCoupleId(profile.coupleId);
            await loadCitiesAndPlaces(profile.coupleId);
            await loadGallery(profile.coupleId);
          } else {
            setHasLinkedAccount(false);
          }
        } catch (error: any) {
          console.error("Error loading user profile or data:", error);
          if (error?.code === 'permission-denied' || error?.message?.includes('permissions')) {
            Alert.alert(
              "Firestore Permission Error",
              "Access denied by Firestore security rules. Please update the rules in Firebase Console to allow authenticated read/write access."
            );
          }
        } finally {
          setLoading(false);
        }
      } else {
        setUser(null);
        setHasLinkedAccount(false);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const loadCitiesAndPlaces = async (coupleId: string) => {
    try {
      const fetchedData = await getUnlockedCities(coupleId);
      const uniqueCitiesMap = new Map();
      fetchedData.forEach((data: any) => {
        const cleanName = normalizeText(data.name || '');
        const uniqueKey = data.cityId || cleanName;
        if (!uniqueCitiesMap.has(uniqueKey)) {
          uniqueCitiesMap.set(uniqueKey, { id: data.cityId, name: data.name, latitude: data.latitude, longitude: data.longitude });
        }
      });
      setUnlockedCities(Array.from(uniqueCitiesMap.values()));
      const places = await getAllSavedPlaces(coupleId);
      setSavedMapPlaces(places);
    } catch (error) {
      console.error("Error loading cities and places:", error);
    }
  };

  const loadGallery = async (coupleId: string) => {
    try {
      setIsLoadingGallery(true);
      const memories = await getAllCoupleMemories(coupleId);
      setGalleryMemories(memories);
    } catch (error) {
      console.error("Error loading gallery:", error);
    } finally {
      setIsLoadingGallery(false);
    }
  };

  const handleAddNewCity = async (city: City) => {
    if (!myCoupleId) return;
    try {
      await unlockCity(myCoupleId, city);
      await loadCitiesAndPlaces(myCoupleId);
      setShowAddCityModal(false); setCitySearchQuery(''); setCitySearchResults([]); setCitySearchError(null);
      mapRef.current?.animateToRegion({ latitude: city.latitude, longitude: city.longitude, latitudeDelta: 0.15, longitudeDelta: 0.15 });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleCitySearch = (text: string) => {
    setCitySearchQuery(text);
    if (citySearchTimeoutRef.current) clearTimeout(citySearchTimeoutRef.current);
    if (citySearchAbortControllerRef.current) citySearchAbortControllerRef.current.abort();
    setCitySearchError(null);
    const trimmed = text.trim();
    if (trimmed.length < 2) { setCitySearchResults([]); setIsSearchingCity(false); return; }

    setIsSearchingCity(true);
    citySearchTimeoutRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      citySearchAbortControllerRef.current = abortController;
      try {
        const found = await searchCities(trimmed, abortController.signal);
        setCitySearchResults(found.filter((c) => !unlockedCities.some((u) => normalizeText(u.name) === normalizeText(c.name))));
      } catch (e: any) {
        if (isAbortError(e)) return;
        setCitySearchResults([]); setCitySearchError(e?.message || 'Search failed. Please try again.');
      } finally { if (citySearchAbortControllerRef.current === abortController) setIsSearchingCity(false); }
    }, SEARCH_DEBOUNCE_MS);
  };


  const handleDeleteCity = (city: City) => {
    Alert.alert('Remove City', `Are you sure you want to remove ${city.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          if (!myCoupleId) return;
          try {
            await deleteUnlockedCity(myCoupleId, city.id); await loadCitiesAndPlaces(myCoupleId);
            setMapMode('default'); setSelectedCity(null);
          } catch (err: any) { Alert.alert('Error', err.message); }
        },
      },
    ]);
  };

  const onCityTap = (city: City) => { setSelectedCity(city); setMapMode('city_menu'); };
  const handleRegionChangeComplete = (region: Region) => { setShowPlaces(region.latitudeDelta < ZOOM_THRESHOLD); };

  const handleOSMSearch = (text: string) => {
    setSearchQuery(text);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (searchAbortControllerRef.current) searchAbortControllerRef.current.abort();
    setSearchError(null);
    const trimmed = text.trim();
    if (trimmed.length < 2) { setSearchResults([]); setIsSearchingLocation(false); return; }

    setIsSearchingLocation(true);
    searchTimeoutRef.current = setTimeout(async () => {
      const abortController = new AbortController(); searchAbortControllerRef.current = abortController;
      try {
        setSearchResults(await searchPlaces(trimmed, selectedCity, abortController.signal));
      } catch (e: any) {
        if (isAbortError(e)) return;
        setSearchResults([]); setSearchError(e?.message || 'Search failed. Please try again.');
      } finally { if (searchAbortControllerRef.current === abortController) setIsSearchingLocation(false); }
    }, SEARCH_DEBOUNCE_MS);
  };

  const selectSearchResult = (item: any) => {
    Keyboard.dismiss(); setPreviewPlace(item); setSearchResults([]); setSearchQuery(item.name || item.display_name.split(',')[0]);
    mapRef.current?.animateToRegion({ latitude: parseFloat(item.lat), longitude: parseFloat(item.lon), latitudeDelta: 0.02, longitudeDelta: 0.02 });
  };

  const handlePoiClick = (e: any) => {
    if (!selectedCity) return Alert.alert("Select a City", "Please select a city first to add this location.");
    const { coordinate, name, placeId } = e.nativeEvent;
    setPreviewPlace({ place_id: `poi_${placeId || Date.now()}`, name: name || '', display_name: name || 'Selected Place', lat: coordinate.latitude.toString(), lon: coordinate.longitude.toString() });
    setCustomPlaceName(name || ''); setMapMode('search_place'); setSearchResults([]); setSearchQuery('');
  };

  const handleMapLongPress = (e: any) => {
    if (!selectedCity) return Alert.alert("Select a City", "Please select a city first, then long-press anywhere to add a custom spot.");
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPreviewPlace({ place_id: `custom_${Date.now()}`, name: '', display_name: 'Custom Map Pin', lat: latitude.toString(), lon: longitude.toString() });
    setCustomPlaceName(''); setMapMode('search_place'); setSearchResults([]); setSearchQuery('');
  };

  const confirmAddPlace = async () => {
    if (!selectedCity || !previewPlace) return;
    Keyboard.dismiss();
    const finalPlaceData = { ...previewPlace };
    const placeIdStr = String(finalPlaceData.place_id);
    if (placeIdStr.startsWith('custom_') || placeIdStr.startsWith('poi_')) finalPlaceData.name = customPlaceName.trim();

    try {
      await savePlace(myCoupleId, selectedCity.id, finalPlaceData);
      setPreviewPlace(null); setSearchQuery(''); setCustomPlaceName(''); setMapMode('default'); setSelectedCity(null);
      await loadCitiesAndPlaces(myCoupleId);
      mapRef.current?.animateToRegion({ latitude: selectedCity.latitude, longitude: selectedCity.longitude, latitudeDelta: 0.1, longitudeDelta: 0.1 });
    } catch (err: any) {
      Alert.alert('Error adding place', err.message);
    }
  };

  const cancelSearch = () => {
    Keyboard.dismiss(); setMapMode('default'); setSelectedCity(null); setPreviewPlace(null); setSearchQuery(''); setSearchResults([]); setSearchError(null); setCustomPlaceName('');
  };

  const handleMapPress = () => {
    if (mapMode === 'city_menu') { setMapMode('default'); setSelectedCity(null); }
  };

  const handleConnectPartner = async (code: string) => {
    const partnerCode = code.trim();
    if (!partnerCode || !user) return;
    try {
      Keyboard.dismiss(); await linkCoupleAccounts(user.uid, partnerCode);
      setMyCoupleId(partnerCode); await loadCitiesAndPlaces(partnerCode); await loadGallery(partnerCode);
      Alert.alert("Success!", "Accounts connected. Your maps are now synced.");
      setShowSettingsModal(false);
    } catch (error: any) { Alert.alert("Error", error.message); }
  };

  const galleryPhotos = galleryMemories.flatMap(mem => (mem.photoUrls || []).map((url: string, index: number) => ({ id: `${mem.id}-${index}`, url: url, dateVisited: mem.dateVisited, placeId: mem.placeId, notes: mem.notes })));
  const today = new Date();
  const onThisDayPhotos = galleryPhotos.filter(photo => {
    const d = new Date(photo.dateVisited);
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() < today.getFullYear();
  });

  if (loading) return <View style={styles.centered}><ActivityIndicator size="large" color="#fff" /></View>;
  if (!user) return <LoginScreen />;
  if (!hasLinkedAccount) return <LinkAccountScreen onLinked={() => setHasLinkedAccount(true)} />;

  return (
    <GestureHandlerRootView style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={LITHUANIA_REGION}
        onRegionChangeComplete={handleRegionChangeComplete}
        onLongPress={handleMapLongPress}
        onPoiClick={handlePoiClick}
        onPress={handleMapPress}
      >
        {unlockedCities.map((city, index) => (
          <Marker key={`city-${city.id}-${index}`} coordinate={{ latitude: city.latitude, longitude: city.longitude }} title={city.name} pinColor="purple" onPress={(e) => { e.stopPropagation(); onCityTap(city); }} />
        ))}
        {showPlaces && savedMapPlaces.map((place) => {
          if (!place.lat || !place.lon) return null;
          return <Marker key={`place-${place.id}`} coordinate={{ latitude: parseFloat(place.lat), longitude: parseFloat(place.lon) }} title={place.name}><FontAwesome name="star" size={24} color="#FFCC00" /></Marker>;
        })}
        {previewPlace && <Marker coordinate={{ latitude: parseFloat(previewPlace.lat), longitude: parseFloat(previewPlace.lon) }} pinColor="blue" title={previewPlace.name || customPlaceName || previewPlace.display_name.split(',')[0]} />}
      </MapView>

      {mapMode === 'default' && (
        <View style={styles.topToolbar}>
          <TouchableOpacity onPress={() => setShowAddCityModal(true)} style={styles.glassButtonWrapper}>
            <BlurView intensity={85} tint="dark" style={styles.glassButton}><Text style={styles.addCityText}>+ Add City</Text></BlurView>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowSettingsModal(true); loadGallery(myCoupleId); }} style={styles.glassButtonWrapper}>
            <BlurView intensity={85} tint="dark" style={styles.glassIcon}><FontAwesome name="bars" size={20} color="#fff" /></BlurView>
          </TouchableOpacity>
        </View>
      )}

      {mapMode === 'search_place' && (
        <View style={styles.searchOverlay}>
          <BlurView intensity={85} tint="dark" style={styles.searchHeaderGlass}>
            <TouchableOpacity onPress={cancelSearch} style={styles.circularCloseButtonHeader}><FontAwesome name="times" size={16} color="#ebebf5" /></TouchableOpacity>
            <TextInput style={styles.searchInput} placeholder={`Search in ${selectedCity?.name}...`} placeholderTextColor="#8e8e93" value={searchQuery} onChangeText={handleOSMSearch} />
            {isSearchingLocation && <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 8 }} />}
          </BlurView>
          {!!searchError && <BlurView intensity={85} tint="dark" style={styles.searchResultsBox}><Text style={styles.searchErrorText}>{searchError}</Text></BlurView>}
          {searchResults.length > 0 && (
            <BlurView intensity={85} tint="dark" style={styles.searchResultsBox}>
              {searchResults.map((item) => (
                <TouchableOpacity key={item.place_id} style={styles.resultItem} onPress={() => selectSearchResult(item)}>
                  <Text style={styles.resultName} numberOfLines={1}>{item.name || item.display_name.split(',')[0]}</Text>
                  <Text style={styles.resultAddress} numberOfLines={1}>{item.display_name}</Text>
                </TouchableOpacity>
              ))}
            </BlurView>
          )}
        </View>
      )}

      {mapMode === 'search_place' && previewPlace && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.previewBottomBar}>
          <BlurView intensity={85} tint="dark" style={styles.previewGlass}>
            {(String(previewPlace.place_id).startsWith('custom_') || String(previewPlace.place_id).startsWith('poi_')) ? (
              <TextInput style={styles.customNameInput} placeholder="Name this spot" placeholderTextColor="#8e8e93" value={customPlaceName} onChangeText={setCustomPlaceName} autoFocus={String(previewPlace.place_id).startsWith('custom_')} />
            ) : (<Text style={styles.previewName} numberOfLines={1}>{previewPlace.name || previewPlace.display_name.split(',')[0]}</Text>)}
            <View style={styles.previewActionRow}>
              <TouchableOpacity style={styles.cancelPreviewButton} onPress={cancelSearch}><Text style={styles.cancelPreviewText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.savePreviewButton, (String(previewPlace.place_id).startsWith('custom_') || String(previewPlace.place_id).startsWith('poi_')) && !customPlaceName.trim() ? { backgroundColor: 'rgba(255,255,255,0.2)' } : {}]} disabled={(String(previewPlace.place_id).startsWith('custom_') || String(previewPlace.place_id).startsWith('poi_')) && !customPlaceName.trim()} onPress={confirmAddPlace}><Text style={styles.savePreviewText}>Save</Text></TouchableOpacity>
            </View>
          </BlurView>
        </KeyboardAvoidingView>
      )}

      {/* --- SETTINGS BURGER MENU --- */}
      {showSettingsModal && (
        <MenuSheet
          stats={{ cities: unlockedCities.length, places: savedMapPlaces.length, memories: galleryMemories.length, photos: galleryPhotos.length }}
          photos={galleryPhotos}
          onThisDayPhotos={onThisDayPhotos}
          placeNameFor={(placeId) => savedMapPlaces.find(p => p.placeId === placeId)?.name}
          isLoadingGallery={isLoadingGallery}
          uid={user?.uid}
          getThumbnailUrl={getThumbnailUrl}
          onOpenPhoto={(photoId) => setExpandedGalleryIndex(galleryPhotos.findIndex(p => p.id === photoId))}
          onConnectPartner={handleConnectPartner}
          onSignOut={() => signOut(auth)}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {/* --- FULLSCREEN GALLERY OVERLAY --- */}
      {expandedGalleryIndex !== null && (
        <View style={styles.fullScreenRootOverlay}>
          <TouchableOpacity style={styles.closeFullScreenBtnRoot} onPress={() => setExpandedGalleryIndex(null)}>
            <FontAwesome name="times" size={24} color="#fff" />
          </TouchableOpacity>
          <FlatList
            ref={fullScreenListRef} data={galleryPhotos} keyExtractor={item => item.id} horizontal pagingEnabled showsHorizontalScrollIndicator={false} initialScrollIndex={expandedGalleryIndex} initialNumToRender={1} windowSize={7} maxToRenderPerBatch={2} removeClippedSubviews={Platform.OS === 'android'} getItemLayout={(data, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })} onScrollToIndexFailed={info => { const wait = new Promise(resolve => setTimeout(resolve, 300)); wait.then(() => fullScreenListRef.current?.scrollToIndex({ index: info.index, animated: false })); }}
            renderItem={({ item }) => {
              const mappedPlace = savedMapPlaces.find(p => p.placeId === item.placeId);
              return <FullScreenImageItem item={item} placeName={mappedPlace?.name || 'Unknown Location'} />
            }}
          />
        </View>
      )}

      {/* --- CITY MENU --- */}
      <Modal visible={mapMode === 'city_menu'} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          {/* FIXED: Tapping background closes and unselects city */}
          <Pressable style={styles.absoluteFill} onPress={() => { setMapMode('default'); setSelectedCity(null); }} />
          <BlurView intensity={90} tint="dark" style={styles.menuSheet}>
            <TouchableOpacity style={styles.absoluteCloseButtonSafe} onPress={() => { setMapMode('default'); setSelectedCity(null); }}>
              <FontAwesome name="times" size={16} color="#ebebf5" />
            </TouchableOpacity>
            <Text style={styles.menuTitle}>{selectedCity?.name}</Text>
            <Text style={styles.menuSubtitle}>What would you like to do?</Text>
            <TouchableOpacity style={styles.menuPrimaryButton} onPress={() => setMapMode('search_place')}><Text style={styles.menuPrimaryText}>Search and add place</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuSecondaryButton} onPress={() => setMapMode('view_places')}><Text style={styles.menuSecondaryText}>View saved places</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.menuSecondaryButton, { marginTop: 8 }]} onPress={() => selectedCity && handleDeleteCity(selectedCity)}><Text style={[styles.menuSecondaryText, { color: '#ff453a' }]}>Remove city from map</Text></TouchableOpacity>
          </BlurView>
        </View>
      </Modal>

      {/* --- ADD CITY MENU --- */}
      <Modal visible={showAddCityModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          {/* FIXED: Tapping background closes menu */}
          <Pressable style={styles.absoluteFill} onPress={() => { setShowAddCityModal(false); setCitySearchQuery(''); setCitySearchResults([]); setCitySearchError(null); }} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', justifyContent: 'flex-end', flex: 1 }} pointerEvents="box-none">
            <AnimatedBlurView intensity={90} tint="dark" style={[styles.addCitySheet, { transform: [{ translateY: addCitySlideAnim }] }]}>
              <View style={styles.dragArea} {...addCityPanResponder.panHandlers}>
                <View style={styles.dragPill} />
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>Select a city</Text>
                  <TouchableOpacity onPress={() => { setShowAddCityModal(false); setCitySearchQuery(''); setCitySearchResults([]); setCitySearchError(null); }} style={styles.circularCloseButtonHeader}>
                    <FontAwesome name="times" size={16} color="#ebebf5" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.citySearchContainer}>
                <FontAwesome name="search" size={16} color="#8e8e93" style={styles.citySearchIcon} />
                <TextInput style={styles.citySearchInput} placeholder="Search city..." placeholderTextColor="#8e8e93" value={citySearchQuery} onChangeText={handleCitySearch} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
                {isSearchingCity && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
                {citySearchQuery.length > 0 && <TouchableOpacity onPress={() => { setCitySearchQuery(''); setCitySearchResults([]); setCitySearchError(null); }} style={styles.clearSearchButton}><FontAwesome name="times-circle" size={16} color="#8e8e93" /></TouchableOpacity>}
              </View>
              <FlatList
                data={citySearchResults} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (<TouchableOpacity style={styles.cityListItem} onPress={() => handleAddNewCity(item)}><Text style={styles.cityListText}>{item.name}</Text></TouchableOpacity>)}
                ListEmptyComponent={<View style={styles.emptyListContainer}>{isSearchingCity ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.emptyListText}>{citySearchError ? citySearchError : citySearchQuery.length < 2 ? "Type a city name to search globally" : "No cities found"}</Text>}</View>}
              />
            </AnimatedBlurView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* --- VIEW PLACES (CityDetailSheet) --- */}
      <Modal visible={mapMode === 'view_places'} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          {/* FIXED: Tapping background correctly unselects city */}
          <Pressable style={styles.absoluteFill} onPress={() => { setMapMode('default'); setSelectedCity(null); }} />
          {selectedCity && <CityDetailSheet cityId={selectedCity.id} cityName={selectedCity.name} coupleId={myCoupleId} onClose={() => { setMapMode('default'); setSelectedCity(null); loadGallery(myCoupleId); }} onPlacesUpdated={() => loadCitiesAndPlaces(myCoupleId)} />}
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  map: { width: '100%', height: '100%' },
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  topToolbar: { position: 'absolute', top: 60, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  glassButtonWrapper: { borderRadius: 20, overflow: 'hidden' },
  glassButton: { paddingHorizontal: 20, paddingVertical: 12 },
  addCityText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  glassIcon: { paddingHorizontal: 16, paddingVertical: 12 },

  searchOverlay: { position: 'absolute', top: 60, left: 16, right: 16, zIndex: 10 },
  searchHeaderGlass: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, overflow: 'hidden' },
  searchBackButton: { marginRight: 12 },
  searchBackText: { color: '#0a84ff', fontWeight: 'bold', fontSize: 16 },
  searchInput: { flex: 1, fontSize: 16, color: '#fff' },
  searchResultsBox: { borderRadius: 16, marginTop: 12, padding: 8, overflow: 'hidden' },
  resultItem: { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  resultName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  resultAddress: { fontSize: 12, color: '#ebebf5', marginTop: 4, opacity: 0.7 },

  previewBottomBar: { position: 'absolute', bottom: 40, left: 20, right: 20, borderRadius: 20, overflow: 'hidden' },
  previewGlass: { padding: 20, alignItems: 'center' },
  previewName: { fontSize: 20, fontWeight: 'bold', marginBottom: 16, textAlign: 'center', color: '#fff' },
  customNameInput: { backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 18, fontWeight: 'bold', borderRadius: 12, padding: 16, width: '100%', textAlign: 'center', marginBottom: 16 },
  previewActionRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  cancelPreviewButton: { backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 14, borderRadius: 14, flex: 1, marginRight: 6, alignItems: 'center' },
  cancelPreviewText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  savePreviewButton: { backgroundColor: '#0a84ff', paddingVertical: 14, borderRadius: 14, flex: 1, marginLeft: 6, alignItems: 'center' },
  savePreviewText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },

  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },

  dragArea: { width: '100%', alignItems: 'center', paddingTop: 16, paddingBottom: 16, backgroundColor: 'transparent' },
  dragPill: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 16 },
  sheetTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },

  circularCloseButtonHeader: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255, 255, 255, 0.15)', alignItems: 'center', justifyContent: 'center' },
  absoluteCloseButtonSafe: { position: 'absolute', top: 20, right: 20, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255, 255, 255, 0.15)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },





  fullScreenRootOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000', zIndex: 9999 },
  closeFullScreenBtnRoot: { position: 'absolute', top: 50, right: 20, zIndex: 10000, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  fullScreenItemContainer: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  fullScreenLoader: { position: 'absolute' },
  fullScreenImage: { width: '100%', height: '100%', zIndex: 1 },
  fullScreenDetails: { position: 'absolute', bottom: 50, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', padding: 16, borderRadius: 16, zIndex: 2 },
  fullScreenPlaceName: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  fullScreenDate: { fontSize: 14, color: '#ebebf5' },



  menuSheet: { padding: 24, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 40 },
  menuTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 4, color: '#fff', marginTop: 10 },
  menuSubtitle: { fontSize: 14, color: '#ebebf5', opacity: 0.8, textAlign: 'center', marginBottom: 24 },
  menuPrimaryButton: { backgroundColor: 'rgba(255,255,255,0.15)', padding: 16, borderRadius: 14, alignItems: 'center', marginBottom: 12 },
  menuPrimaryText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  menuSecondaryButton: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 14, alignItems: 'center' },
  menuSecondaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  addCitySheet: { height: '75%', paddingTop: 12, paddingHorizontal: 24, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  citySearchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  citySearchIcon: { marginRight: 8 },
  citySearchInput: { flex: 1, fontSize: 16, color: '#fff', paddingVertical: 0 },
  clearSearchButton: { padding: 4 },
  cityListItem: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  cityListText: { fontSize: 18, color: '#fff' },
  emptyListContainer: { paddingVertical: 32, alignItems: 'center' },
  emptyListText: { fontSize: 16, color: '#8e8e93', textAlign: 'center' },
  searchErrorText: { color: '#ff9f0a', fontSize: 14, padding: 8 },
  emptyText: { textAlign: 'center', color: '#8e8e93', marginTop: 30, fontSize: 16 }
});