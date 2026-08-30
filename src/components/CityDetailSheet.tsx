import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth } from '../config/firebaseConfig';
import { getCityPlaces, getPlaceMemories, saveMemoryLog } from '../services/firestoreService';

interface Props {
  cityId: string;
  cityName: string;
  coupleId: string;
  onClose: () => void;
}

export default function CityDetailSheet({ cityId, cityName, coupleId, onClose }: Props) {
  const [viewMode, setViewMode] = useState<'city' | 'place'>('city');
  const [activePlace, setActivePlace] = useState<any>(null);

  const [savedPlaces, setSavedPlaces] = useState<any[]>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(true);

  const [note, setNote] = useState('');
  const [memories, setMemories] = useState<any[]>([]);
  const [isSavingMemory, setIsSavingMemory] = useState(false);

  useEffect(() => {
    loadSavedPlaces();
  }, [cityId]);

  const loadSavedPlaces = async () => {
    setIsLoadingPlaces(true);
    const places = await getCityPlaces(coupleId, cityId);
    setSavedPlaces(places);
    setIsLoadingPlaces(false);
  };

  const openPlace = async (place: any) => {
    setActivePlace(place);
    setViewMode('place');
    const fetchedMemories = await getPlaceMemories(coupleId, place.placeId);
    setMemories(fetchedMemories);
  };

  const handleSaveMemory = async () => {
    if (!note.trim() || !auth.currentUser || !activePlace) return;
    
    setIsSavingMemory(true);
    const newLog = {
      coupleId: coupleId,
      cityId: cityId,
      placeId: activePlace.placeId,
      notes: note.trim(),
      dateVisited: Date.now(),
      photoUrls: [], 
      createdBy: auth.currentUser.uid,
    };

    await saveMemoryLog(newLog);
    setNote('');
    const fetchedMemories = await getPlaceMemories(coupleId, activePlace.placeId);
    setMemories(fetchedMemories);
    setIsSavingMemory(false);
  };

  if (viewMode === 'city') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.cityName}>{cityName} Places</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        {isLoadingPlaces ? (
          <ActivityIndicator style={styles.loader} color="#007AFF" />
        ) : (
          <FlatList
            data={savedPlaces}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.savedPlaceCard} onPress={() => openPlace(item)}>
                <Text style={styles.savedPlaceName}>{item.name}</Text>
                <Text style={styles.savedPlaceDate}>Added: {new Date(item.addedAt).toLocaleDateString()}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No saved places yet. Use the map search to add some!</Text>
            }
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setViewMode('city')}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.cityName} numberOfLines={1}>{activePlace?.name}</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="What did you do here?"
          value={note}
          onChangeText={setNote}
          multiline
        />
        <TouchableOpacity 
          style={[styles.saveButton, !note.trim() && styles.saveButtonDisabled]} 
          onPress={handleSaveMemory}
          disabled={!note.trim() || isSavingMemory}
        >
          <Text style={styles.saveButtonText}>{isSavingMemory ? '...' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Memories</Text>
      <FlatList
        data={memories}
        keyExtractor={(item) => item.id || Math.random().toString()}
        renderItem={({ item }) => (
          <View style={styles.logCard}>
            <Text style={styles.dateText}>{new Date(item.dateVisited).toLocaleDateString()}</Text>
            <Text style={styles.noteText}>{item.notes}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No memories yet. Add your first!</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: '85%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  cityName: { fontSize: 22, fontWeight: 'bold', flex: 1, textAlign: 'center', marginHorizontal: 10 },
  closeText: { fontSize: 16, color: '#ff3b30', fontWeight: '600' },
  backText: { fontSize: 16, color: '#007AFF', fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#333' },
  savedPlaceCard: { backgroundColor: '#f0f8ff', padding: 16, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#ccebff' },
  savedPlaceName: { fontSize: 18, fontWeight: 'bold', color: '#005999' },
  savedPlaceDate: { fontSize: 12, color: '#666', marginTop: 4 },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 24 },
  input: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 8, padding: 12, minHeight: 40, maxHeight: 100, marginRight: 12 },
  saveButton: { backgroundColor: '#34c759', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8 },
  saveButtonDisabled: { backgroundColor: '#a1e4b3' },
  saveButtonText: { color: '#fff', fontWeight: 'bold' },
  logCard: { backgroundColor: '#f8f9fa', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  dateText: { fontSize: 12, color: '#888', marginBottom: 6 },
  noteText: { fontSize: 16, color: '#333' },
  loader: { marginVertical: 20 },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 20, fontStyle: 'italic' }
});