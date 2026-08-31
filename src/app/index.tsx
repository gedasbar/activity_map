import { FontAwesome } from '@expo/vector-icons';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, Keyboard, Image, Pressable } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import CityDetailSheet from '../components/CityDetailSheet';
import LinkAccountScreen from '../components/LinkAccountScreen';
import LoginScreen from '../components/LoginScreen';
import { auth } from '../config/firebaseConfig';
import { CITY_CATALOG, City } from '../constants/cities';
import { getAllSavedPlaces, getUnlockedCities, getUserProfile, linkCoupleAccounts, savePlace, unlockCity, deleteUnlockedCity, getAllCoupleMemories } from '../services/firestoreService';

const LITHUANIA_REGION = { latitude: 55.1694, longitude: 23.8813, latitudeDelta: 3.2, longitudeDelta: 4.8 };
const ZOOM_THRESHOLD = 0.15;

const normalizeText = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function App() {
  const mapRef = useRef<MapView>(null);

  const [mapMode, setMapMode] = useState<'default' | 'city_menu' | 'view_places' | 'search_place'>('default');
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [unlockedCities, setUnlockedCities] = useState<City[]>([]);
  const [savedMapPlaces, setSavedMapPlaces] = useState<any[]>([]);
  const [showAddCityModal, setShowAddCityModal] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const [citySearchResults, setCitySearchResults] = useState<City[]>([]);
  const [isSearchingCity, setIsSearchingCity] = useState(false);
  const citySearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const citySearchAbortControllerRef = useRef<AbortController | null>(null);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'gallery' | 'stats' | 'sync'>('gallery');
  const [galleryMemories, setGalleryMemories] = useState<any[]>([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(false);

  const [showPlaces, setShowPlaces] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [previewPlace, setPreviewPlace] = useState<any>(null);
  const [customPlaceName, setCustomPlaceName] = useState('');

  const [partnerCodeInput, setPartnerCodeInput] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [hasLinkedAccount, setHasLinkedAccount] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [myCoupleId, setMyCoupleId] = useState<string>('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setLoading(true); setUser(currentUser);
        const profile = await getUserProfile(currentUser.uid);
        if (profile?.coupleId) {
          setHasLinkedAccount(true); setMyCoupleId(profile.coupleId);
          await loadCitiesAndPlaces(profile.coupleId);
          await loadGallery(profile.coupleId);
        }
        setLoading(false);
      } else {
        setUser(null); setHasLinkedAccount(false); setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const loadCitiesAndPlaces = async (coupleId: string) => {
    const fetchedData = await getUnlockedCities(coupleId);
    setUnlockedCities(fetchedData.map((data: any) => ({ id: data.cityId, name: data.name, latitude: data.latitude, longitude: data.longitude })));
    setSavedMapPlaces(await getAllSavedPlaces(coupleId));
  };

  const loadGallery = async (coupleId: string) => {
    setIsLoadingGallery(true);
    const memories = await getAllCoupleMemories(coupleId);
    setGalleryMemories(memories);
    setIsLoadingGallery(false);
  };

  const handleAddNewCity = async (city: City) => {
    if (!myCoupleId) return;
    await unlockCity(myCoupleId, city);
    await loadCitiesAndPlaces(myCoupleId);
    setShowAddCityModal(false); setCitySearchQuery(''); setCitySearchResults([]);
    mapRef.current?.animateToRegion({ latitude: city.latitude, longitude: city.longitude, latitudeDelta: 0.15, longitudeDelta: 0.15 });
  };

  const handleCitySearch = (text: string) => {
    setCitySearchQuery(text);
    if (citySearchTimeoutRef.current) clearTimeout(citySearchTimeoutRef.current);
    if (citySearchAbortControllerRef.current) citySearchAbortControllerRef.current.abort();
    const trimmed = text.trim();
    if (trimmed.length < 2) { setCitySearchResults([]); setIsSearchingCity(false); return; }

    setIsSearchingCity(true);
    citySearchTimeoutRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      citySearchAbortControllerRef.current = abortController;
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${trimmed}, Lietuva`)}&format=json&limit=5&addressdetails=1&countrycodes=lt&accept-language=lt`;
        const response = await fetch(url, { signal: abortController.signal, headers: { 'User-Agent': 'ActivityMapApp/1.0', 'Accept-Language': 'lt, en;q=0.5' } });
        if (!response.ok) { setIsSearchingCity(false); return; }
        const contentType = response.headers.get('content-type') || '';
        let data: any[] = [];
        if (!contentType.includes('application/json')) {
          const textResponse = await response.text();
          if (textResponse.trim().startsWith('<')) { setIsSearchingCity(false); return; }
          data = JSON.parse(textResponse);
        } else {
          data = await response.json();
        }
        if (Array.isArray(data)) {
          const mapped: City[] = data
              .map((item: any) => ({ id: `osm_${item.place_id}`, name: item.name || item.display_name.split(',')[0].trim(), latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) }))
              .filter((c) => !unlockedCities.some((u) => normalizeText(u.name) === normalizeText(c.name)));
          setCitySearchResults(mapped);
        }
      } catch (e: any) { if (e.name !== 'AbortError') console.error(e); } finally { setIsSearchingCity(false); }
    }, 400);
  };

  const handleDeleteCity = (city: City) => {
    Alert.alert('Remove City', `Are you sure you want to remove ${city.name}?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: async () => {
              if (!myCoupleId) return;
              try { await deleteUnlockedCity(myCoupleId, city.id); await loadCitiesAndPlaces(myCoupleId); setMapMode('default'); setSelectedCity(null); }
              catch (err: any) { Alert.alert('Error', err.message); }
            },
          },
        ]
    );
  };

  const onCityTap = (city: City) => { setSelectedCity(city); setMapMode('city_menu'); };

  const handleRegionChangeComplete = (region: Region) => {
    if (region.latitudeDelta < ZOOM_THRESHOLD) { if (!showPlaces) setShowPlaces(true); }
    else { if (showPlaces) setShowPlaces(false); }
  };

  const handleOSMSearch = (text: string) => {
    setSearchQuery(text);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (searchAbortControllerRef.current) searchAbortControllerRef.current.abort();
    const trimmed = text.trim();
    if (trimmed.length < 2) { setSearchResults([]); setIsSearchingLocation(false); return; }

    setIsSearchingLocation(true);
    searchTimeoutRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      searchAbortControllerRef.current = abortController;
      try {
        const query = selectedCity ? `${trimmed}, ${selectedCity.name}, Lietuva` : `${trimmed}, Lietuva`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&countrycodes=lt&accept-language=lt`;
        const response = await fetch(url, { signal: abortController.signal, headers: { 'User-Agent': 'ActivityMapApp/1.0', 'Accept-Language': 'lt, en;q=0.5' } });
        if (!response.ok) { setIsSearchingLocation(false); return; }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const textResponse = await response.text();
          if (textResponse.trim().startsWith('<')) { setIsSearchingLocation(false); return; }
          setSearchResults(Array.isArray(JSON.parse(textResponse)) ? JSON.parse(textResponse) : []);
        } else {
          const data = await response.json();
          setSearchResults(Array.isArray(data) ? data : []);
        }
      } catch (e: any) { if (e.name !== 'AbortError') console.error(e); } finally { setIsSearchingLocation(false); }
    }, 400);
  };

  const selectSearchResult = (item: any) => {
    Keyboard.dismiss();
    setPreviewPlace(item); setSearchResults([]); setSearchQuery(item.name || item.display_name.split(',')[0]);
    mapRef.current?.animateToRegion({ latitude: parseFloat(item.lat), longitude: parseFloat(item.lon), latitudeDelta: 0.02, longitudeDelta: 0.02 });
  };

  const handlePoiClick = (e: any) => {
    if (!selectedCity) {
      Alert.alert("Select a City", "Please select a city first to add this location.");
      return;
    }
    const { coordinate, name, placeId } = e.nativeEvent;
    setPreviewPlace({
      place_id: `poi_${placeId || Date.now()}`,
      name: name || '',
      display_name: name || 'Selected Place',
      lat: coordinate.latitude.toString(),
      lon: coordinate.longitude.toString()
    });
    setCustomPlaceName(name || '');
    setMapMode('search_place');
    setSearchResults([]);
    setSearchQuery('');
  };

  const handleMapLongPress = (e: any) => {
    if (!selectedCity) {
      Alert.alert("Select a City", "Please select a city first, then long-press anywhere to add a custom spot.");
      return;
    }
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPreviewPlace({
      place_id: `custom_${Date.now()}`,
      name: '',
      display_name: 'Custom Map Pin',
      lat: latitude.toString(),
      lon: longitude.toString()
    });
    setCustomPlaceName('');
    setMapMode('search_place');
    setSearchResults([]);
    setSearchQuery('');
  };

  const confirmAddPlace = async () => {
    if (!selectedCity || !previewPlace) return;
    Keyboard.dismiss();

    const finalPlaceData = { ...previewPlace };
    const placeIdStr = String(finalPlaceData.place_id); // Convert to string safely

    if (placeIdStr.startsWith('custom_') || placeIdStr.startsWith('poi_')) {
      finalPlaceData.name = customPlaceName.trim();
    }

    await savePlace(myCoupleId, selectedCity.id, finalPlaceData);
    setPreviewPlace(null); setSearchQuery(''); setCustomPlaceName(''); setMapMode('city_menu');
    await loadCitiesAndPlaces(myCoupleId);
    mapRef.current?.animateToRegion({ latitude: selectedCity.latitude, longitude: selectedCity.longitude, latitudeDelta: 0.1, longitudeDelta: 0.1 });
  };

  const cancelSearch = () => {
    Keyboard.dismiss();
    setMapMode('city_menu'); setPreviewPlace(null); setSearchQuery(''); setSearchResults([]); setCustomPlaceName('');
    if (selectedCity) mapRef.current?.animateToRegion({ latitude: selectedCity.latitude, longitude: selectedCity.longitude, latitudeDelta: 0.1, longitudeDelta: 0.1 });
  };

  const handleConnectPartner = async () => {
    if (!partnerCodeInput.trim() || !user) return;
    try {
      Keyboard.dismiss();
      await linkCoupleAccounts(user.uid, partnerCodeInput.trim());
      setMyCoupleId(partnerCodeInput.trim());
      await loadCitiesAndPlaces(partnerCodeInput.trim());
      await loadGallery(partnerCodeInput.trim());
      Alert.alert("Success!", "Accounts connected. Your maps are now synced.");
      setPartnerCodeInput(''); setShowSettingsModal(false);
    } catch (error: any) { Alert.alert("Error", error.message); }
  };

  const availableCitiesToAdd = CITY_CATALOG
      .filter(c => !unlockedCities.some(u => u.id === c.id || normalizeText(u.name) === normalizeText(c.name)))
      .filter(c => !citySearchQuery.trim() || normalizeText(c.name).includes(normalizeText(citySearchQuery.trim())));

  const combinedCitiesToAdd = [
    ...availableCitiesToAdd,
    ...citySearchResults.filter(osmCity => !availableCitiesToAdd.some(c => normalizeText(c.name) === normalizeText(osmCity.name)) && !unlockedCities.some(u => normalizeText(u.name) === normalizeText(osmCity.name))),
  ];

  const totalCities = CITY_CATALOG.length;
  const visitedCities = unlockedCities.length;
  const unvisitedCities = Math.max(0, totalCities - visitedCities);
  const visitedPercentage = totalCities > 0 ? Math.round((visitedCities / totalCities) * 100) : 0;
  const totalPlaces = savedMapPlaces.length;

  if (loading) return <View style={styles.centered}><ActivityIndicator size="large" color="#fff" /></View>;
  if (!user) return <LoginScreen />;
  if (!hasLinkedAccount) return <LinkAccountScreen onLinked={() => setHasLinkedAccount(true)} />;

  return (
      <View style={styles.container}>
        <MapView
            ref={mapRef}
            provider={PROVIDER_DEFAULT}
            style={styles.map}
            initialRegion={LITHUANIA_REGION}
            onRegionChangeComplete={handleRegionChangeComplete}
            onLongPress={handleMapLongPress}
            onPoiClick={handlePoiClick}
        >
          {unlockedCities.map((city) => <Marker key={`city-${city.id}`} coordinate={{ latitude: city.latitude, longitude: city.longitude }} title={city.name} onPress={() => onCityTap(city)} />)}
          {showPlaces && savedMapPlaces.map((place) => {
            if (!place.lat || !place.lon) return null;
            return <Marker key={`place-${place.id}`} coordinate={{ latitude: parseFloat(place.lat), longitude: parseFloat(place.lon) }} title={place.name}><FontAwesome name="star" size={24} color="#FFCC00" /></Marker>;
          })}
          {previewPlace && <Marker coordinate={{ latitude: parseFloat(previewPlace.lat), longitude: parseFloat(previewPlace.lon) }} pinColor="blue" title={previewPlace.name || customPlaceName || previewPlace.display_name.split(',')[0]} />}
        </MapView>

        {mapMode === 'default' && (
            <View style={styles.topToolbar}>
              <TouchableOpacity onPress={() => setShowAddCityModal(true)} style={styles.glassButtonWrapper}>
                <BlurView intensity={85} tint="dark" style={styles.glassButton}>
                  <Text style={styles.addCityText}>+ Add City</Text>
                </BlurView>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setShowSettingsModal(true); loadGallery(myCoupleId); }} style={styles.glassButtonWrapper}>
                <BlurView intensity={85} tint="dark" style={styles.glassIcon}>
                  <FontAwesome name="bars" size={20} color="#fff" />
                </BlurView>
              </TouchableOpacity>
            </View>
        )}

        {mapMode === 'search_place' && (
            <View style={styles.searchOverlay}>
              <BlurView intensity={85} tint="dark" style={styles.searchHeaderGlass}>
                <TouchableOpacity onPress={cancelSearch} style={styles.searchBackButton}>
                  <Text style={styles.searchBackText}>Cancel</Text>
                </TouchableOpacity>
                <TextInput
                    style={styles.searchInput}
                    placeholder={`Search in ${selectedCity?.name}...`}
                    placeholderTextColor="#8e8e93"
                    value={searchQuery}
                    onChangeText={handleOSMSearch}
                />
                {isSearchingLocation && <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 8 }} />}
              </BlurView>

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
                    <TextInput
                        style={styles.customNameInput}
                        placeholder="Name this spot (e.g., Lake shore)"
                        placeholderTextColor="#8e8e93"
                        value={customPlaceName}
                        onChangeText={setCustomPlaceName}
                        autoFocus={String(previewPlace.place_id).startsWith('custom_')}
                    />
                ) : (
                    <Text style={styles.previewName} numberOfLines={1}>{previewPlace.name || previewPlace.display_name.split(',')[0]}</Text>
                )}

                <View style={styles.previewActionRow}>
                  <TouchableOpacity style={styles.cancelPreviewButton} onPress={cancelSearch}>
                    <Text style={styles.cancelPreviewText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                      style={[styles.savePreviewButton, (String(previewPlace.place_id).startsWith('custom_') || String(previewPlace.place_id).startsWith('poi_')) && !customPlaceName.trim() ? { backgroundColor: 'rgba(255,255,255,0.2)' } : {}]}
                      disabled={(String(previewPlace.place_id).startsWith('custom_') || String(previewPlace.place_id).startsWith('poi_')) && !customPlaceName.trim()}
                      onPress={confirmAddPlace}
                  >
                    <Text style={styles.savePreviewText}>Save</Text>
                  </TouchableOpacity>
                </View>

              </BlurView>
            </KeyboardAvoidingView>
        )}

        <Modal visible={showSettingsModal} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <BlurView intensity={90} tint="dark" style={styles.settingsSheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Menu</Text>
                <TouchableOpacity onPress={() => setShowSettingsModal(false)}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
              </View>

              <View style={styles.tabsContainer}>
                <TouchableOpacity style={[styles.tabButton, settingsTab === 'gallery' && styles.tabButtonActive]} onPress={() => setSettingsTab('gallery')}>
                  <Text style={[styles.tabText, settingsTab === 'gallery' && styles.tabTextActive]}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tabButton, settingsTab === 'stats' && styles.tabButtonActive]} onPress={() => setSettingsTab('stats')}>
                  <Text style={[styles.tabText, settingsTab === 'stats' && styles.tabTextActive]}>Stats</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tabButton, settingsTab === 'sync' && styles.tabButtonActive]} onPress={() => setSettingsTab('sync')}>
                  <Text style={[styles.tabText, settingsTab === 'sync' && styles.tabTextActive]}>Sync</Text>
                </TouchableOpacity>
              </View>

              {settingsTab === 'gallery' && (
                  <View style={styles.tabContentAreaGallery}>
                    {isLoadingGallery ? (
                        <ActivityIndicator color="#fff" style={{marginTop: 40}} />
                    ) : (
                        <FlatList
                            data={galleryMemories}
                            keyExtractor={item => item.id}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{ paddingBottom: 40 }}
                            renderItem={({item}) => {
                              const mappedPlace = savedMapPlaces.find(p => p.placeId === item.placeId);
                              return (
                                  <View style={styles.galleryCard}>
                                    {item.photoUrls && item.photoUrls.length > 0 && (
                                        <Image source={{uri: item.photoUrls[0]}} style={styles.galleryImage} resizeMode="cover" />
                                    )}
                                    <View style={styles.galleryTextContainer}>
                                      <Text style={styles.galleryPlaceName}>{mappedPlace?.name || 'Unknown Location'}</Text>
                                      <Text style={styles.galleryDate}>{new Date(item.dateVisited).toLocaleDateString()}</Text>
                                      {item.notes ? <Text style={styles.galleryNotes}>{item.notes}</Text> : null}
                                    </View>
                                  </View>
                              )
                            }}
                            ListEmptyComponent={<Text style={styles.emptyText}>No memories added yet.</Text>}
                        />
                    )}
                  </View>
              )}

              {settingsTab === 'stats' && (
                  <View style={styles.tabContentArea}>
                    <View style={styles.statsRow}>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{visitedPercentage}%</Text>
                        <Text style={styles.statLabel}>Lithuania Explored</Text>
                      </View>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{visitedCities}</Text>
                        <Text style={styles.statLabel}>Cities Visited</Text>
                      </View>
                    </View>
                    <View style={styles.statsRow}>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{totalPlaces}</Text>
                        <Text style={styles.statLabel}>Total Places Saved</Text>
                      </View>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{unvisitedCities}</Text>
                        <Text style={styles.statLabel}>Cities Left to Visit</Text>
                      </View>
                    </View>
                  </View>
              )}

              {settingsTab === 'sync' && (
                  <View style={styles.tabContentArea}>
                    <Text style={styles.settingsSubtitle}>Share your code with your partner, or paste theirs below to sync your maps.</Text>
                    <View style={styles.codeBox}>
                      <Text style={styles.label}>Your Code (Long press to copy):</Text>
                      <Text style={styles.codeText} selectable>{user?.uid}</Text>
                    </View>
                    <TextInput style={styles.settingsInput} placeholder="Partner's Connection Code" placeholderTextColor="#8e8e93" value={partnerCodeInput} onChangeText={setPartnerCodeInput} autoCapitalize="none" />
                    <TouchableOpacity style={styles.primarySettingsButton} onPress={handleConnectPartner}>
                      <Text style={styles.primaryButtonText}>Connect Accounts</Text>
                    </TouchableOpacity>
                    <View style={styles.divider} />
                    <TouchableOpacity style={styles.signOutButtonLarge} onPress={() => signOut(auth)}>
                      <Text style={styles.signOutTextLarge}>Log Out</Text>
                    </TouchableOpacity>
                  </View>
              )}
            </BlurView>
          </View>
        </Modal>

        <Modal visible={mapMode === 'city_menu'} transparent animationType="fade">
          {/* The outer Pressable acts as the background click detector */}
          <Pressable style={styles.modalBackdrop} onPress={() => setMapMode('default')}>

            {/* The inner Pressable stops the click from triggering when you tap the actual menu */}
            <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
              <BlurView intensity={90} tint="dark" style={styles.menuSheet}>
                <Text style={styles.menuTitle}>{selectedCity?.name}</Text>
                <Text style={styles.menuSubtitle}>What would you like to do?</Text>

                <TouchableOpacity style={styles.menuPrimaryButton} onPress={() => setMapMode('search_place')}>
                  <Text style={styles.menuPrimaryText}>Search and add place</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuSecondaryButton} onPress={() => setMapMode('view_places')}>
                  <Text style={styles.menuSecondaryText}>View saved places</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.menuSecondaryButton, { marginTop: 8 }]} onPress={() => selectedCity && handleDeleteCity(selectedCity)}>
                  <Text style={[styles.menuSecondaryText, { color: '#ff453a' }]}>Remove city from map</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.menuSecondaryButton, { marginTop: 16, backgroundColor: 'transparent' }]} onPress={() => setMapMode('default')}>
                  <Text style={[styles.menuSecondaryText, { color: '#8e8e93' }]}>Cancel</Text>
                </TouchableOpacity>
              </BlurView>
            </Pressable>

          </Pressable>
        </Modal>

        <Modal visible={showAddCityModal} transparent animationType="slide">
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
            <BlurView intensity={90} tint="dark" style={styles.addCitySheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Select a city</Text>
                <TouchableOpacity onPress={() => { setShowAddCityModal(false); setCitySearchQuery(''); setCitySearchResults([]); }}>
                  <Text style={styles.closeText}>Cancel</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.citySearchContainer}>
                <FontAwesome name="search" size={16} color="#8e8e93" style={styles.citySearchIcon} />
                <TextInput style={styles.citySearchInput} placeholder="Search city..." placeholderTextColor="#8e8e93" value={citySearchQuery} onChangeText={handleCitySearch} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
                {isSearchingCity && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
                {citySearchQuery.length > 0 && <TouchableOpacity onPress={() => { setCitySearchQuery(''); setCitySearchResults([]); }} style={styles.clearSearchButton}><FontAwesome name="times-circle" size={16} color="#8e8e93" /></TouchableOpacity>}
              </View>
              <FlatList
                  data={combinedCitiesToAdd}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                      <TouchableOpacity style={styles.cityListItem} onPress={() => handleAddNewCity(item)}>
                        <Text style={styles.cityListText}>{item.name}</Text>
                      </TouchableOpacity>
                  )}
                  ListEmptyComponent={<View style={styles.emptyListContainer}>{isSearchingCity ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.emptyListText}>No cities found</Text>}</View>}
              />
            </BlurView>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={mapMode === 'view_places'} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            {selectedCity && <CityDetailSheet cityId={selectedCity.id} cityName={selectedCity.name} coupleId={myCoupleId} onClose={() => { setMapMode('default'); loadGallery(myCoupleId); }} onPlacesUpdated={() => loadCitiesAndPlaces(myCoupleId)} />}
          </View>
        </Modal>
      </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  map: { width: '100%', height: '100%' },

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

  // NEW: Cancel & Save Action Row
  previewActionRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  cancelPreviewButton: { backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 14, borderRadius: 14, flex: 1, marginRight: 6, alignItems: 'center' },
  cancelPreviewText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  savePreviewButton: { backgroundColor: '#0a84ff', paddingVertical: 14, borderRadius: 14, flex: 1, marginLeft: 6, alignItems: 'center' },
  savePreviewText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },

  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },

  settingsSheet: { height: '85%', padding: 24, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  tabsContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 4, marginBottom: 20 },
  tabButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabButtonActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  tabText: { color: '#ebebf5', fontSize: 15, fontWeight: '600', opacity: 0.7 },
  tabTextActive: { color: '#fff', opacity: 1 },
  tabContentArea: { flex: 0 },
  tabContentAreaGallery: { flex: 1 },

  galleryCard: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  galleryImage: { width: '100%', height: 220, backgroundColor: 'rgba(255,255,255,0.1)' },
  galleryTextContainer: { padding: 16 },
  galleryPlaceName: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  galleryDate: { fontSize: 12, color: '#ebebf5', opacity: 0.7, marginBottom: 8 },
  galleryNotes: { fontSize: 15, color: '#fff', lineHeight: 22 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16, marginHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  statLabel: { fontSize: 12, color: '#ebebf5', opacity: 0.7, textAlign: 'center', fontWeight: '500' },

  settingsSubtitle: { fontSize: 14, color: '#ebebf5', opacity: 0.8, marginBottom: 20, lineHeight: 20 },
  codeBox: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 14, marginBottom: 20 },
  label: { fontSize: 12, color: '#ebebf5', opacity: 0.6, marginBottom: 6, fontWeight: '600', textTransform: 'uppercase' },
  codeText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  settingsInput: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 16, fontSize: 16, marginBottom: 16, color: '#fff' },
  primarySettingsButton: { backgroundColor: '#0a84ff', padding: 16, borderRadius: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 24 },
  signOutButtonLarge: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 14, alignItems: 'center' },
  signOutTextLarge: { color: '#ff453a', fontSize: 16, fontWeight: 'bold' },

  menuSheet: { padding: 24, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 40 },
  menuTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 4, color: '#fff' },
  menuSubtitle: { fontSize: 14, color: '#ebebf5', opacity: 0.8, textAlign: 'center', marginBottom: 24 },
  menuPrimaryButton: { backgroundColor: 'rgba(255,255,255,0.15)', padding: 16, borderRadius: 14, alignItems: 'center', marginBottom: 12 },
  menuPrimaryText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  menuSecondaryButton: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 14, alignItems: 'center' },
  menuSecondaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  addCitySheet: { height: '75%', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  closeText: { fontSize: 16, color: '#0a84ff', fontWeight: '600' },
  citySearchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  citySearchIcon: { marginRight: 8 },
  citySearchInput: { flex: 1, fontSize: 16, color: '#fff', paddingVertical: 0 },
  clearSearchButton: { padding: 4 },
  cityListItem: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  cityListText: { fontSize: 18, color: '#fff' },
  emptyListContainer: { paddingVertical: 32, alignItems: 'center' },
  emptyListText: { fontSize: 16, color: '#8e8e93' },
  emptyText: { textAlign: 'center', color: '#8e8e93', marginTop: 30, fontSize: 16 }
});