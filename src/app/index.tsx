import { FontAwesome } from '@expo/vector-icons';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import CityDetailSheet from '../components/CityDetailSheet';
import LinkAccountScreen from '../components/LinkAccountScreen';
import LoginScreen from '../components/LoginScreen';
import { auth } from '../config/firebaseConfig';
import { CITY_CATALOG, City } from '../constants/cities';
import { getAllSavedPlaces, getUnlockedCities, getUserProfile, linkCoupleAccounts, savePlace, unlockCity, deleteUnlockedCity } from '../services/firestoreService';

const LITHUANIA_REGION = { latitude: 55.1694, longitude: 23.8813, latitudeDelta: 3.2, longitudeDelta: 4.8 };
const ZOOM_THRESHOLD = 0.15;

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

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
  
  const [showPlaces, setShowPlaces] = useState(false); 
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [previewPlace, setPreviewPlace] = useState<any>(null); 
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
        setLoading(true);
        setUser(currentUser);
        const profile = await getUserProfile(currentUser.uid);
        if (profile?.coupleId) {
          setHasLinkedAccount(true);
          setMyCoupleId(profile.coupleId);
          await loadCitiesAndPlaces(profile.coupleId);
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
    const formattedCities: City[] = fetchedData.map((data: any) => ({
      id: data.cityId, name: data.name, latitude: data.latitude, longitude: data.longitude
    }));
    setUnlockedCities(formattedCities);

    const fetchedPlaces = await getAllSavedPlaces(coupleId);
    setSavedMapPlaces(fetchedPlaces);
  };

  const handleAddNewCity = async (city: City) => {
    if (!myCoupleId) return;
    await unlockCity(myCoupleId, city);
    await loadCitiesAndPlaces(myCoupleId);
    setShowAddCityModal(false);
    setCitySearchQuery('');
    setCitySearchResults([]);
    mapRef.current?.animateToRegion({
      latitude: city.latitude,
      longitude: city.longitude,
      latitudeDelta: 0.15,
      longitudeDelta: 0.15,
    });
  };

  const handleCitySearch = (text: string) => {
    setCitySearchQuery(text);

    if (citySearchTimeoutRef.current) {
      clearTimeout(citySearchTimeoutRef.current);
    }
    if (citySearchAbortControllerRef.current) {
      citySearchAbortControllerRef.current.abort();
    }

    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setCitySearchResults([]);
      setIsSearchingCity(false);
      return;
    }

    setIsSearchingCity(true);
    citySearchTimeoutRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      citySearchAbortControllerRef.current = abortController;

      try {
        const query = `${trimmed}, Lietuva`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&countrycodes=lt&accept-language=lt`;

        const response = await fetch(url, {
          signal: abortController.signal,
          headers: {
            'User-Agent': 'ActivityMapApp/1.0 (activitymap@app.lt)',
            'Accept-Language': 'lt, en;q=0.5',
          },
        });

        if (!response.ok) {
          setIsSearchingCity(false);
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        let data: any[] = [];
        if (!contentType.includes('application/json')) {
          const textResponse = await response.text();
          if (textResponse.trim().startsWith('<')) {
            setIsSearchingCity(false);
            return;
          }
          data = JSON.parse(textResponse);
        } else {
          data = await response.json();
        }

        if (Array.isArray(data)) {
          const mapped: City[] = data
            .map((item: any) => {
              const name = item.name || item.display_name.split(',')[0].trim();
              const id = `osm_${item.place_id}`;
              return {
                id,
                name,
                latitude: parseFloat(item.lat),
                longitude: parseFloat(item.lon),
              };
            })
            .filter((c) => !unlockedCities.some((u) => normalizeText(u.name) === normalizeText(c.name)));
          setCitySearchResults(mapped);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error("City search error: ", e);
        }
      } finally {
        setIsSearchingCity(false);
      }
    }, 400);
  };

  const handleDeleteCity = (city: City) => {
    Alert.alert(
      'Remove City',
      `Are you sure you want to remove ${city.name} and all its saved places?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!myCoupleId) return;
            try {
              await deleteUnlockedCity(myCoupleId, city.id);
              await loadCitiesAndPlaces(myCoupleId);
              setMapMode('default');
              setSelectedCity(null);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not remove city');
            }
          },
        },
      ]
    );
  };

  const onCityTap = (city: City) => {
    setSelectedCity(city);
    setMapMode('city_menu');
  };

  const handleRegionChangeComplete = (region: Region) => {
    if (region.latitudeDelta < ZOOM_THRESHOLD) {
      if (!showPlaces) setShowPlaces(true);
    } else {
      if (showPlaces) setShowPlaces(false);
    }
  };

  const handleOSMSearch = (text: string) => {
    setSearchQuery(text);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }

    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearchingLocation(false);
      return;
    }

    setIsSearchingLocation(true);
    searchTimeoutRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      searchAbortControllerRef.current = abortController;

      try {
        const query = selectedCity ? `${trimmed}, ${selectedCity.name}, Lietuva` : `${trimmed}, Lietuva`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&countrycodes=lt&accept-language=lt`;

        const response = await fetch(url, {
          signal: abortController.signal,
          headers: {
            'User-Agent': 'ActivityMapApp/1.0 (activitymap@app.lt)',
            'Accept-Language': 'lt, en;q=0.5',
          },
        });

        if (!response.ok) {
          setIsSearchingLocation(false);
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const textResponse = await response.text();
          if (textResponse.trim().startsWith('<')) {
            // HTML error response / rate limit
            setIsSearchingLocation(false);
            return;
          }
          const data = JSON.parse(textResponse);
          setSearchResults(Array.isArray(data) ? data : []);
        } else {
          const data = await response.json();
          setSearchResults(Array.isArray(data) ? data : []);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error("Search error: ", e);
        }
      } finally {
        setIsSearchingLocation(false);
      }
    }, 400);
  };

  const selectSearchResult = (item: any) => {
    setPreviewPlace(item);
    setSearchResults([]); 
    setSearchQuery(item.name || item.display_name.split(',')[0]);
    
    mapRef.current?.animateToRegion({
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  };

  const confirmAddPlace = async () => {
    if (!selectedCity || !previewPlace) return;
    await savePlace(myCoupleId, selectedCity.id, previewPlace);
    
    setPreviewPlace(null);
    setSearchQuery('');
    setMapMode('city_menu'); 
    await loadCitiesAndPlaces(myCoupleId);
    
    mapRef.current?.animateToRegion({
      latitude: selectedCity.latitude,
      longitude: selectedCity.longitude,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    });
  };

  const cancelSearch = () => {
    setMapMode('city_menu');
    setPreviewPlace(null);
    setSearchQuery('');
    setSearchResults([]);
    if (selectedCity) {
      mapRef.current?.animateToRegion({
        latitude: selectedCity.latitude, longitude: selectedCity.longitude, latitudeDelta: 0.1, longitudeDelta: 0.1
      });
    }
  };

  const handleConnectPartner = async () => {
    if (!partnerCodeInput.trim() || !user) return;
    try {
      const newCoupleId = partnerCodeInput.trim();
      await linkCoupleAccounts(user.uid, newCoupleId);
      setMyCoupleId(newCoupleId);
      await loadCitiesAndPlaces(newCoupleId); 
      Alert.alert("Success!", "Accounts connected. Your maps are now synced.");
      setPartnerCodeInput('');
      setShowSettingsModal(false);
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  };

  const availableCitiesToAdd = CITY_CATALOG
    .filter(c => !unlockedCities.some(u => u.id === c.id || normalizeText(u.name) === normalizeText(c.name)))
    .filter(c => {
      if (!citySearchQuery.trim()) return true;
      const normalizedQuery = normalizeText(citySearchQuery.trim());
      const normalizedName = normalizeText(c.name);
      return normalizedName.includes(normalizedQuery);
    });

  const combinedCitiesToAdd = [
    ...availableCitiesToAdd,
    ...citySearchResults.filter(
      osmCity =>
        !availableCitiesToAdd.some(c => normalizeText(c.name) === normalizeText(osmCity.name)) &&
        !unlockedCities.some(u => normalizeText(u.name) === normalizeText(osmCity.name))
    ),
  ];

  if (loading) return <View style={styles.centered}><ActivityIndicator size="large" color="#007AFF" /></View>;
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
      >
        
        {unlockedCities.map((city) => (
          <Marker
            key={`city-${city.id}`}
            coordinate={{ latitude: city.latitude, longitude: city.longitude }}
            title={city.name}
            onPress={() => onCityTap(city)}
          />
        ))}

        {showPlaces && savedMapPlaces.map((place) => {
          if (!place.lat || !place.lon) return null;
          return (
            <Marker
              key={`place-${place.id}`}
              coordinate={{ latitude: parseFloat(place.lat), longitude: parseFloat(place.lon) }}
              title={place.name}
            >
              <FontAwesome name="star" size={24} color="#FFCC00" />
            </Marker>
          );
        })}

        {previewPlace && (
          <Marker
            coordinate={{ latitude: parseFloat(previewPlace.lat), longitude: parseFloat(previewPlace.lon) }}
            pinColor="blue"
            title={previewPlace.name || previewPlace.display_name.split(',')[0]}
          />
        )}
      </MapView>

      {mapMode === 'default' && (
        <View style={styles.topToolbar}>
          <TouchableOpacity style={styles.addCityButton} onPress={() => setShowAddCityModal(true)}>
            <Text style={styles.addCityText}>+ Add City</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsIcon} onPress={() => setShowSettingsModal(true)}>
            <FontAwesome name="cog" size={24} color="#333" />
          </TouchableOpacity>
        </View>
      )}

      {mapMode === 'search_place' && (
        <View style={styles.searchOverlay}>
          <View style={styles.searchHeader}>
            <TouchableOpacity onPress={cancelSearch} style={styles.searchBackButton}>
              <Text style={styles.searchBackText}>Back</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.searchInput}
              placeholder={`Search in ${selectedCity?.name}...`}
              value={searchQuery}
              onChangeText={handleOSMSearch}
              autoFocus
            />
            {isSearchingLocation && (
              <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />
            )}
          </View>
          
          {searchResults.length > 0 && (
            <View style={styles.searchResultsBox}>
              {searchResults.map((item) => (
                <TouchableOpacity key={item.place_id} style={styles.resultItem} onPress={() => selectSearchResult(item)}>
                  <Text style={styles.resultName} numberOfLines={1}>{item.name || item.display_name.split(',')[0]}</Text>
                  <Text style={styles.resultAddress} numberOfLines={1}>{item.display_name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {mapMode === 'search_place' && previewPlace && (
        <View style={styles.previewBottomBar}>
          <Text style={styles.previewName} numberOfLines={1}>
            {previewPlace.name || previewPlace.display_name.split(',')[0]}
          </Text>
          <TouchableOpacity style={styles.savePreviewButton} onPress={confirmAddPlace}>
            <Text style={styles.savePreviewText}>Save this place</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SETTINGS MODAL */}
      <Modal visible={showSettingsModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.settingsSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Settings</Text>
              <TouchableOpacity onPress={() => setShowSettingsModal(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.settingsSubtitle}>Share your code with your partner, or paste theirs below to sync your maps.</Text>

            <View style={styles.codeBox}>
              <Text style={styles.label}>Your Code (Long press to copy):</Text>
              <Text style={styles.codeText} selectable>{user?.uid}</Text>
            </View>

            <TextInput
              style={styles.settingsInput}
              placeholder="Partner's Connection Code"
              value={partnerCodeInput}
              onChangeText={setPartnerCodeInput}
              autoCapitalize="none"
            />

            <TouchableOpacity style={styles.primarySettingsButton} onPress={handleConnectPartner}>
              <Text style={styles.primaryButtonText}>Connect Accounts</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.signOutButtonLarge} onPress={() => signOut(auth)}>
              <Text style={styles.signOutTextLarge}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={mapMode === 'city_menu'} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>{selectedCity?.name}</Text>
            <Text style={styles.menuSubtitle}>What would you like to do?</Text>
            
            <TouchableOpacity style={styles.menuPrimaryButton} onPress={() => setMapMode('search_place')}>
              <Text style={styles.menuPrimaryText}>Search and add place</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.menuSecondaryButton} onPress={() => setMapMode('view_places')}>
              <Text style={styles.menuSecondaryText}>View saved places</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.menuSecondaryButton, { marginTop: 8 }]} 
              onPress={() => selectedCity && handleDeleteCity(selectedCity)}
            >
              <Text style={[styles.menuSecondaryText, { color: '#ff3b30' }]}>Remove city from map</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.menuSecondaryButton, { marginTop: 16, borderBottomWidth: 0 }]} onPress={() => setMapMode('default')}>
              <Text style={[styles.menuSecondaryText, { color: '#666' }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showAddCityModal} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.addCitySheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select a city</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowAddCityModal(false);
                  setCitySearchQuery('');
                  setCitySearchResults([]);
                }}
              >
                <Text style={styles.closeText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.citySearchContainer}>
              <FontAwesome name="search" size={16} color="#8e8e93" style={styles.citySearchIcon} />
              <TextInput
                style={styles.citySearchInput}
                placeholder="Search city..."
                placeholderTextColor="#8e8e93"
                value={citySearchQuery}
                onChangeText={handleCitySearch}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
              {isSearchingCity && (
                <ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 6 }} />
              )}
              {citySearchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setCitySearchQuery('');
                    setCitySearchResults([]);
                  }}
                  style={styles.clearSearchButton}
                >
                  <FontAwesome name="times-circle" size={16} color="#8e8e93" />
                </TouchableOpacity>
              )}
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
              ListEmptyComponent={
                <View style={styles.emptyListContainer}>
                  {isSearchingCity ? (
                    <ActivityIndicator size="small" color="#007AFF" />
                  ) : (
                    <Text style={styles.emptyListText}>No cities found</Text>
                  )}
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={mapMode === 'view_places'} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          {selectedCity && (
            <CityDetailSheet
              cityId={selectedCity.id}
              cityName={selectedCity.name}
              coupleId={myCoupleId}
              onClose={() => setMapMode('default')}
              onPlacesUpdated={() => loadCitiesAndPlaces(myCoupleId)}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  map: { width: '100%', height: '100%' },
  
  topToolbar: { position: 'absolute', top: 60, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addCityButton: { backgroundColor: '#34c759', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4 },
  addCityText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  settingsIcon: { backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4 },

  searchOverlay: { position: 'absolute', top: 60, left: 16, right: 16, zIndex: 10 },
  searchHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5 },
  searchBackButton: { marginRight: 12 },
  searchBackText: { color: '#007AFF', fontWeight: 'bold', fontSize: 16 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 8 },
  searchResultsBox: { backgroundColor: '#fff', borderRadius: 12, marginTop: 8, padding: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, maxHeight: 250 },
  resultItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  resultName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  resultAddress: { fontSize: 12, color: '#666', marginTop: 4 },

  previewBottomBar: { position: 'absolute', bottom: 40, left: 20, right: 20, backgroundColor: '#fff', padding: 20, borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, alignItems: 'center' },
  previewName: { fontSize: 20, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' },
  savePreviewButton: { backgroundColor: '#007AFF', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, width: '100%', alignItems: 'center' },
  savePreviewText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  
  settingsSheet: { backgroundColor: '#fff', padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  settingsSubtitle: { fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 20 },
  codeBox: { backgroundColor: '#f0f8ff', padding: 16, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#ccebff' },
  label: { fontSize: 12, color: '#005999', marginBottom: 6, fontWeight: 'bold', textTransform: 'uppercase' },
  codeText: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  settingsInput: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 16 },
  primarySettingsButton: { backgroundColor: '#34c759', padding: 16, borderRadius: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 24 },
  signOutButtonLarge: { backgroundColor: '#ff3b30', padding: 16, borderRadius: 12, alignItems: 'center' },
  signOutTextLarge: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  menuSheet: { backgroundColor: '#fff', padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  menuTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  menuSubtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 24 },
  menuPrimaryButton: { backgroundColor: '#007AFF', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  menuPrimaryText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  menuSecondaryButton: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee', alignItems: 'center' },
  menuSecondaryText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  
  addCitySheet: { height: '75%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 22, fontWeight: 'bold' },
  closeText: { fontSize: 16, color: '#007AFF', fontWeight: '600' },
  citySearchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f2f2f7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  citySearchIcon: { marginRight: 8 },
  citySearchInput: { flex: 1, fontSize: 16, color: '#333', paddingVertical: 0 },
  clearSearchButton: { padding: 4 },
  cityListItem: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  cityListText: { fontSize: 18, color: '#333' },
  emptyListContainer: { paddingVertical: 32, alignItems: 'center' },
  emptyListText: { fontSize: 16, color: '#8e8e93' }
});