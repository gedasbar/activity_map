import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View, Image, Modal } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { auth } from '../config/firebaseConfig';
import { deleteMemoryLog, deleteSavedPlace, getCityPlaces, getPlaceMemories, saveMemoryLog, updatePlaceRating } from '../services/firestoreService';

// --- CLOUDINARY CONFIG ---
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/jpxtr4kd/image/upload';
const UPLOAD_PRESET = 'pind_map';

interface Props {
  cityId: string;
  cityName: string;
  coupleId: string;
  onClose: () => void;
  onPlacesUpdated?: () => void;
}

export default function CityDetailSheet({ cityId, cityName, coupleId, onClose, onPlacesUpdated }: Props) {
  const [viewMode, setViewMode] = useState<'city' | 'place'>('city');
  const [activePlace, setActivePlace] = useState<any>(null);

  const [savedPlaces, setSavedPlaces] = useState<any[]>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(true);

  const [note, setNote] = useState('');
  const [memories, setMemories] = useState<any[]>([]);
  const [isSavingMemory, setIsSavingMemory] = useState(false);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  // Rating State
  const [ratingPlace, setRatingPlace] = useState<any>(null);
  const [tempRating, setTempRating] = useState<number>(0);

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

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const uploadImageToCloudinary = async (imageUri: string) => {
    const data = new FormData();
    data.append('file', {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'upload.jpg',
    } as any);
    data.append('upload_preset', UPLOAD_PRESET);

    const response = await fetch(CLOUDINARY_URL, {
      method: 'POST',
      body: data,
    });
    const result = await response.json();
    return result.secure_url;
  };

  const handleSaveMemory = async () => {
    if (!auth.currentUser || !activePlace) return;
    if (!note.trim() && !selectedImage) return;

    setIsSavingMemory(true);
    let uploadedPhotoUrl = '';

    try {
      if (selectedImage) {
        uploadedPhotoUrl = await uploadImageToCloudinary(selectedImage);
      }

      const newLog = {
        coupleId: coupleId,
        cityId: cityId,
        placeId: activePlace.placeId,
        notes: note.trim(),
        dateVisited: Date.now(),
        photoUrls: uploadedPhotoUrl ? [uploadedPhotoUrl] : [],
        createdBy: auth.currentUser.uid,
      };

      await saveMemoryLog(newLog);

      setNote('');
      setSelectedImage(null);

      const fetchedMemories = await getPlaceMemories(coupleId, activePlace.placeId);
      setMemories(fetchedMemories);
    } catch (error: any) {
      Alert.alert("Upload Error", "Failed to save the memory or image.");
      console.error(error);
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleDeletePlace = (place: any) => {
    Alert.alert(
        'Delete Place',
        `Are you sure you want to delete "${place.name}" and all its recorded memories?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteSavedPlace(place.id, coupleId, place.placeId);
                await loadSavedPlaces();
                onPlacesUpdated?.();
              } catch (err: any) {
                Alert.alert('Error', err.message || 'Could not delete place');
              }
            },
          },
        ]
    );
  };

  const handleDeleteMemory = (log: any) => {
    Alert.alert(
        'Delete Memory',
        'Are you sure you want to delete this recorded memory?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              if (!log.id || !activePlace) return;
              try {
                await deleteMemoryLog(log.id);
                const fetchedMemories = await getPlaceMemories(coupleId, activePlace.placeId);
                setMemories(fetchedMemories);
              } catch (err: any) {
                Alert.alert('Error', err.message || 'Could not delete record');
              }
            },
          },
        ]
    );
  };

  const openRatingModal = (place: any) => {
    setRatingPlace(place);
    setTempRating(place.rating || 0);
  };

  const saveRating = async () => {
    if (!ratingPlace) return;
    try {
      await updatePlaceRating(ratingPlace.id, tempRating);
      await loadSavedPlaces();
      setRatingPlace(null);
    } catch (error) {
      Alert.alert("Error", "Could not save rating.");
    }
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
                      <View style={styles.savedPlaceCard}>
                        <TouchableOpacity style={styles.savedPlaceContent} onPress={() => openPlace(item)}>
                          <Text style={styles.savedPlaceName}>{item.name}</Text>
                          <Text style={styles.savedPlaceDate}>Added: {new Date(item.addedAt).toLocaleDateString()}</Text>
                        </TouchableOpacity>

                        <View style={styles.actionButtonsContainer}>
                          {/* Rating Button */}
                          <TouchableOpacity
                              style={styles.actionButton}
                              onPress={() => openRatingModal(item)}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            {item.rating ? (
                                <View style={styles.ratedBadge}>
                                  <Text style={styles.ratedNumber}>{item.rating}</Text>
                                  <FontAwesome name="star-o" size={20} color="#333" style={{ fontWeight: 'bold' }} />
                                </View>
                            ) : (
                                <FontAwesome name="star-o" size={20} color="#999" />
                            )}
                          </TouchableOpacity>

                          {/* Delete Button */}
                          <TouchableOpacity
                              style={styles.actionButton}
                              onPress={() => handleDeletePlace(item)}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <FontAwesome name="trash-o" size={20} color="#ff3b30" />
                          </TouchableOpacity>
                        </View>
                      </View>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>No saved places yet. Use the map search to add some!</Text>
                  }
              />
          )}

          {/* Custom Rating Dialog */}
          <Modal visible={!!ratingPlace} transparent animationType="fade">
            <View style={styles.modalBackdrop}>
              <View style={styles.ratingDialog}>
                <Text style={styles.ratingTitle}>Rate</Text>
                <Text style={styles.ratingSubtitle} numberOfLines={1}>{ratingPlace?.name}</Text>

                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                      <View key={star} style={styles.starContainer}>
                        {/* Background Star Icon */}
                        <View style={styles.starIconWrapper} pointerEvents="none">
                          <FontAwesome
                              name={tempRating >= star ? 'star' : tempRating >= star - 0.5 ? 'star-half-o' : 'star-o'}
                              size={36}
                              color="#333"
                          />
                        </View>
                        {/* Invisible Touch Zones for 0.5 precision */}
                        <View style={styles.starTouchZones}>
                          <TouchableOpacity style={styles.halfStarZone} onPress={() => setTempRating(star - 0.5)} />
                          <TouchableOpacity style={styles.halfStarZone} onPress={() => setTempRating(star)} />
                        </View>
                      </View>
                  ))}
                </View>

                <Text style={styles.ratingDisplay}>{tempRating > 0 ? tempRating : 'Select a rating'}</Text>

                <View style={styles.ratingActionRow}>
                  <TouchableOpacity style={styles.ratingCancelBtn} onPress={() => setRatingPlace(null)}>
                    <Text style={styles.ratingCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ratingDoneBtn} onPress={saveRating}>
                    <Text style={styles.ratingDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
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

        <View style={styles.inputArea}>
          <TextInput
              style={styles.input}
              placeholder="What did you do here?"
              value={note}
              onChangeText={setNote}
              multiline
          />

          {selectedImage && (
              <View style={styles.imagePreviewContainer}>
                <Image source={{ uri: selectedImage }} style={styles.imagePreview} />
                <TouchableOpacity style={styles.removeImageBtn} onPress={() => setSelectedImage(null)}>
                  <Text style={styles.removeImageText}>✕</Text>
                </TouchableOpacity>
              </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.photoButton} onPress={pickImage}>
              <Text style={styles.photoButtonText}>Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.saveButton, (!note.trim() && !selectedImage) && styles.saveButtonDisabled]}
                onPress={handleSaveMemory}
                disabled={(!note.trim() && !selectedImage) || isSavingMemory}
            >
              <Text style={styles.saveButtonText}>{isSavingMemory ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Memories</Text>
        <FlatList
            data={memories}
            keyExtractor={(item) => item.id || Math.random().toString()}
            renderItem={({ item }) => (
                <View style={styles.logCard}>
                  <View style={styles.logCardHeader}>
                    <Text style={styles.dateText}>{new Date(item.dateVisited).toLocaleDateString()}</Text>
                    <TouchableOpacity
                        style={styles.deleteLogButton}
                        onPress={() => handleDeleteMemory(item)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <FontAwesome name="trash-o" size={16} color="#ff3b30" />
                    </TouchableOpacity>
                  </View>

                  {item.photoUrls && item.photoUrls.length > 0 && (
                      <TouchableOpacity onPress={() => setExpandedImage(item.photoUrls[0])} activeOpacity={0.9}>
                        <Image source={{ uri: item.photoUrls[0] }} style={styles.memoryImage} resizeMode="cover" />
                      </TouchableOpacity>
                  )}

                  {item.notes ? <Text style={styles.noteText}>{item.notes}</Text> : null}
                </View>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No memories yet. Add your first!</Text>}
        />

        <Modal visible={!!expandedImage} transparent={true} animationType="fade" onRequestClose={() => setExpandedImage(null)}>
          <View style={styles.fullScreenImageContainer}>
            <TouchableOpacity style={styles.closeFullScreenButton} onPress={() => setExpandedImage(null)}>
              <FontAwesome name="times" size={28} color="#fff" />
            </TouchableOpacity>
            {expandedImage && (
                <Image source={{ uri: expandedImage }} style={styles.fullScreenImage} resizeMode="contain" />
            )}
          </View>
        </Modal>
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

  savedPlaceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f8ff', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#ccebff', padding: 16 },
  savedPlaceContent: { flex: 1, marginRight: 10 },
  savedPlaceName: { fontSize: 18, fontWeight: 'bold', color: '#005999' },
  savedPlaceDate: { fontSize: 12, color: '#666', marginTop: 4 },

  actionButtonsContainer: { flexDirection: 'row', alignItems: 'center' },
  actionButton: { padding: 8, marginLeft: 4, justifyContent: 'center', alignItems: 'center' },
  ratedBadge: { flexDirection: 'row', alignItems: 'center' },
  ratedNumber: { fontSize: 16, fontWeight: 'bold', color: '#333', marginRight: 4 },

  inputArea: { marginBottom: 24, backgroundColor: '#f9f9f9', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#eee' },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, minHeight: 60, maxHeight: 120, marginBottom: 12, borderWidth: 1, borderColor: '#e0e0e0' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  photoButton: { backgroundColor: '#e8e8e8', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  photoButtonText: { color: '#333', fontWeight: '600' },
  saveButton: { backgroundColor: '#34c759', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  saveButtonDisabled: { backgroundColor: '#a1e4b3' },
  saveButtonText: { color: '#fff', fontWeight: 'bold' },
  imagePreviewContainer: { position: 'relative', marginBottom: 12, alignSelf: 'flex-start' },
  imagePreview: { width: 100, height: 100, borderRadius: 8 },
  removeImageBtn: { position: 'absolute', top: -5, right: -5, backgroundColor: 'red', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  removeImageText: { color: 'white', fontWeight: 'bold', fontSize: 12 },

  logCard: { backgroundColor: '#f8f9fa', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  logCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  deleteLogButton: { padding: 4 },
  dateText: { fontSize: 12, color: '#888' },
  memoryImage: { width: '100%', height: 200, borderRadius: 8, marginBottom: 12, backgroundColor: '#e1e4e8' },
  noteText: { fontSize: 16, color: '#333' },
  loader: { marginVertical: 20 },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 20, fontStyle: 'italic' },

  fullScreenImageContainer: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)', justifyContent: 'center', alignItems: 'center' },
  closeFullScreenButton: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 16 },
  fullScreenImage: { width: '100%', height: '100%' },

  // Rating Modal Styles
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  ratingDialog: { width: '80%', backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'center' },
  ratingTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  ratingSubtitle: { fontSize: 14, color: '#666', marginBottom: 24, textAlign: 'center' },
  starsRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16 },
  starContainer: { width: 44, height: 44, marginHorizontal: 2, position: 'relative' },
  starIconWrapper: { position: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  starTouchZones: { flex: 1, flexDirection: 'row' },
  halfStarZone: { flex: 1, height: '100%' },
  ratingDisplay: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 24 },
  ratingActionRow: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 16 },
  ratingCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  ratingCancelText: { color: '#ff3b30', fontSize: 16, fontWeight: '600' },
  ratingDoneBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderLeftWidth: 1, borderLeftColor: '#eee' },
  ratingDoneText: { color: '#007AFF', fontSize: 16, fontWeight: 'bold' }
});