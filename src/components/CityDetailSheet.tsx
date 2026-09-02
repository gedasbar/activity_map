import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View, Image, Modal, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { BlurView } from 'expo-blur';
import DateTimePicker from '@react-native-community/datetimepicker';
import { auth } from '../config/firebaseConfig';
import { deleteMemoryLog, deleteSavedPlace, getCityPlaces, getPlaceMemories, saveMemoryLog, updatePlaceRating, updateMemoryDate } from '../services/firestoreService';

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

  // --- NEW: Multiple Assets State ---
  const [selectedAssets, setSelectedAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const [ratingPlace, setRatingPlace] = useState<any>(null);
  const [tempRating, setTempRating] = useState<number>(0);

  const [visitDate, setVisitDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<Date>(new Date());

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
      mediaTypes: ['images'],
      allowsMultipleSelection: true, // <-- Enable selecting multiple photos
      allowsEditing: false,
      quality: 0.7,
      exif: true,
    });

    if (!result.canceled) {
      // Append newly selected assets so they don't overwrite existing ones if they click "Photo" again
      setSelectedAssets(prev => [...prev, ...result.assets]);

      // If they only picked one photo, update the visual UI date picker so they see the EXIF worked
      if (result.assets.length === 1) {
        const asset = result.assets[0];
        if (asset.exif) {
          const exifDateStr = asset.exif.DateTimeOriginal || asset.exif.DateTimeDigitized || asset.exif.DateTime;
          if (exifDateStr) {
            try {
              const parts = exifDateStr.split(' ');
              const dateParts = parts[0].split(':');
              const timeParts = parts[1].split(':');

              const parsedDate = new Date(
                  parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]),
                  parseInt(timeParts[0]), parseInt(timeParts[1]), parseInt(timeParts[2])
              );

              if (!isNaN(parsedDate.getTime())) setVisitDate(parsedDate);
            } catch (e) { console.log(e); }
          }
        }
      }
    }
  };

  const removeAsset = (indexToRemove: number) => {
    setSelectedAssets(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const uploadImageToCloudinary = async (imageUri: string) => {
    const data = new FormData();
    data.append('file', { uri: imageUri, type: 'image/jpeg', name: 'upload.jpg' } as any);
    data.append('upload_preset', UPLOAD_PRESET);
    const response = await fetch(CLOUDINARY_URL, { method: 'POST', body: data });
    const result = await response.json();
    return result.secure_url;
  };

  const handleSaveMemory = async () => {
    if (!auth.currentUser || !activePlace) return;
    if (!note.trim() && selectedAssets.length === 0) return;

    setIsSavingMemory(true);

    try {
      if (selectedAssets.length > 0) {
        // Loop through every selected photo and process them as independent memories
        for (const asset of selectedAssets) {
          const uploadedPhotoUrl = await uploadImageToCloudinary(asset.uri);

          // Extract date for THIS specific photo (defaults to UI date if no EXIF found)
          let assetDateMs = visitDate.getTime();
          if (asset.exif) {
            const exifDateStr = asset.exif.DateTimeOriginal || asset.exif.DateTimeDigitized || asset.exif.DateTime;
            if (exifDateStr) {
              try {
                const parts = exifDateStr.split(' ');
                const dateParts = parts[0].split(':');
                const timeParts = parts[1].split(':');
                const parsedDate = new Date(
                    parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]),
                    parseInt(timeParts[0]), parseInt(timeParts[1]), parseInt(timeParts[2])
                );
                if (!isNaN(parsedDate.getTime())) assetDateMs = parsedDate.getTime();
              } catch (e) {}
            }
          }

          // If there is only 1 photo, keep the note. If multiple, ditch the note.
          const finalNote = selectedAssets.length === 1 ? note.trim() : '';

          const newLog = {
            coupleId: coupleId,
            cityId: cityId,
            placeId: activePlace.placeId,
            notes: finalNote,
            dateVisited: assetDateMs,
            photoUrls: [uploadedPhotoUrl],
            createdBy: auth.currentUser.uid,
          };

          await saveMemoryLog(newLog);
        }
      } else {
        // Text-only memory (no photos)
        const newLog = {
          coupleId: coupleId,
          cityId: cityId,
          placeId: activePlace.placeId,
          notes: note.trim(),
          dateVisited: visitDate.getTime(),
          photoUrls: [],
          createdBy: auth.currentUser.uid,
        };
        await saveMemoryLog(newLog);
      }

      // Reset
      setNote('');
      setSelectedAssets([]);
      setVisitDate(new Date());

      const fetchedMemories = await getPlaceMemories(coupleId, activePlace.placeId);
      setMemories(fetchedMemories);
    } catch (error: any) {
      Alert.alert("Upload Error", "Failed to save the memories.");
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setVisitDate(selectedDate);
  };

  const handleEditDateChangeAndroid = async (event: any, selectedDate?: Date) => {
    if (event.type === 'set' && selectedDate && editingLogId) {
      await submitEditedDate(editingLogId, selectedDate);
    } else {
      setEditingLogId(null);
    }
  };

  const submitEditedDate = async (logId: string, newDate: Date) => {
    try {
      await updateMemoryDate(logId, newDate.getTime());
      const fetchedMemories = await getPlaceMemories(coupleId, activePlace.placeId);
      setMemories(fetchedMemories);
      setEditingLogId(null);
    } catch (error) {
      Alert.alert("Error", "Could not update date.");
    }
  };

  const handleDeletePlace = (place: any) => {
    Alert.alert('Remove Place', `Are you sure you want to remove "${place.name}"?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: async () => {
              try {
                await deleteSavedPlace(place.id, coupleId, place.placeId);
                await loadSavedPlaces();
                onPlacesUpdated?.();
              } catch (err: any) { Alert.alert('Error', err.message); }
            },
          },
        ]
    );
  };

  const handleDeleteMemory = (log: any) => {
    Alert.alert('Remove Memory', 'Are you sure you want to remove this memory?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: async () => {
              if (!log.id || !activePlace) return;
              try {
                await deleteMemoryLog(log.id);
                const fetchedMemories = await getPlaceMemories(coupleId, activePlace.placeId);
                setMemories(fetchedMemories);
              } catch (err: any) { Alert.alert('Error', err.message); }
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
        <BlurView intensity={85} tint="dark" style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.cityName}>{cityName}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          {isLoadingPlaces ? (
              <ActivityIndicator style={styles.loader} color="#fff" />
          ) : (
              <FlatList
                  data={savedPlaces}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                      <View style={styles.savedPlaceCard}>
                        <TouchableOpacity style={styles.savedPlaceContent} onPress={() => openPlace(item)}>
                          <Text style={styles.savedPlaceName}>{item.name}</Text>
                          <Text style={styles.savedPlaceDate}>Added {new Date(item.addedAt).toLocaleDateString()}</Text>
                        </TouchableOpacity>

                        <View style={styles.actionButtonsContainer}>
                          <TouchableOpacity style={styles.actionButton} onPress={() => openRatingModal(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            {item.rating ? (
                                <View style={styles.ratedBadge}>
                                  <Text style={styles.ratedNumber}>{item.rating}</Text>
                                  <FontAwesome name="star-o" size={20} color="#fff" style={{ fontWeight: 'bold' }} />
                                </View>
                            ) : (
                                <FontAwesome name="star-o" size={20} color="#8e8e93" />
                            )}
                          </TouchableOpacity>

                          <TouchableOpacity style={styles.actionButton} onPress={() => handleDeletePlace(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <FontAwesome name="trash-o" size={20} color="#ff453a" />
                          </TouchableOpacity>
                        </View>
                      </View>
                  )}
                  ListEmptyComponent={<Text style={styles.emptyText}>No places yet.</Text>}
              />
          )}

          <Modal visible={!!ratingPlace} transparent animationType="fade">
            <View style={styles.alertBackdrop}>
              <BlurView intensity={90} tint="dark" style={styles.iosAlertBox}>
                <View style={styles.iosAlertHeader}>
                  <Text style={styles.iosAlertTitle}>Rate Place</Text>
                  <Text style={styles.iosAlertSubtitle} numberOfLines={2}>
                    What rating would you give "{ratingPlace?.name}"?
                  </Text>
                </View>

                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                      <View key={star} style={styles.starContainer}>
                        <View style={styles.starIconWrapper} pointerEvents="none">
                          <FontAwesome name={tempRating >= star ? 'star' : tempRating >= star - 0.5 ? 'star-half-o' : 'star-o'} size={32} color="#fff" />
                        </View>
                        <View style={styles.starTouchZones}>
                          <TouchableOpacity style={styles.halfStarZone} onPress={() => setTempRating(star - 0.5)} />
                          <TouchableOpacity style={styles.halfStarZone} onPress={() => setTempRating(star)} />
                        </View>
                      </View>
                  ))}
                </View>

                <View style={styles.iosAlertButtonRow}>
                  <TouchableOpacity style={[styles.iosAlertPillButton, { backgroundColor: 'rgba(255,255,255,0.15)' }]} onPress={() => setRatingPlace(null)}>
                    <Text style={styles.iosAlertButtonTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.iosAlertPillButton, { backgroundColor: 'rgba(255,255,255,0.15)' }]} onPress={saveRating}>
                    <Text style={styles.iosAlertButtonTextConfirm}>Save</Text>
                  </TouchableOpacity>
                </View>
              </BlurView>
            </View>
          </Modal>
        </BlurView>
    );
  }

  return (
      <BlurView intensity={85} tint="dark" style={styles.container}>
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

          {/* Hide Note Input if multiple photos are selected */}
          {selectedAssets.length <= 1 ? (
              <TextInput
                  style={styles.input}
                  placeholder="Add a memory..."
                  placeholderTextColor="#8e8e93"
                  value={note}
                  onChangeText={setNote}
                  multiline
              />
          ) : (
              <View style={styles.multiPhotoNotice}>
                <FontAwesome name="info-circle" size={16} color="#0a84ff" style={{marginRight: 8}} />
                <Text style={styles.multiPhotoText}>Descriptions are disabled for batch uploads. Each photo will be saved as its own separate memory.</Text>
              </View>
          )}

          {/* Render All Selected Images */}
          {selectedAssets.length > 0 && (
              <View style={styles.imagePreviewRow}>
                {selectedAssets.map((asset, index) => (
                    <View key={index} style={styles.imagePreviewContainer}>
                      <Image source={{ uri: asset.uri }} style={styles.imagePreview} />
                      <TouchableOpacity style={styles.removeImageBtn} onPress={() => removeAsset(index)}>
                        <FontAwesome name="times" size={12} color="#fff" />
                      </TouchableOpacity>
                    </View>
                ))}
              </View>
          )}

          <View style={styles.actionRow}>
            <View style={styles.leftActions}>
              <TouchableOpacity style={styles.actionPillButton} onPress={pickImage}>
                <FontAwesome name="camera" size={14} color="#ebebf5" style={{ marginRight: 6 }} />
                <Text style={styles.actionPillText}>Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionPillButton} onPress={() => setShowDatePicker(true)}>
                <FontAwesome name="calendar" size={14} color="#ebebf5" style={{ marginRight: 6 }} />
                <Text style={styles.actionPillText}>
                  {visitDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
                style={[styles.saveButton, (!note.trim() && selectedAssets.length === 0) && styles.saveButtonDisabled]}
                onPress={handleSaveMemory}
                disabled={(!note.trim() && selectedAssets.length === 0) || isSavingMemory}
            >
              <Text style={styles.saveButtonText}>{isSavingMemory ? `Saving...` : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showDatePicker && (
            Platform.OS === 'ios' ? (
                <View style={styles.iosInlinePickerContainer}>
                  <View style={styles.iosPickerHeader}>
                    <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                      <Text style={styles.iosPickerDoneText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                      value={visitDate}
                      mode="date"
                      display="spinner"
                      textColor="white"
                      themeVariant="dark"
                      onChange={handleDateChange}
                  />
                </View>
            ) : (
                <DateTimePicker
                    value={visitDate}
                    mode="date"
                    display="default"
                    onChange={handleDateChange}
                />
            )
        )}

        <FlatList
            data={memories}
            keyExtractor={(item) => item.id || Math.random().toString()}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
                <View style={styles.logCard}>
                  <View style={styles.logCardHeader}>
                    <TouchableOpacity
                        style={styles.editableDateContainer}
                        onPress={() => {
                          setEditingLogId(item.id);
                          setEditDate(new Date(item.dateVisited));
                        }}
                    >
                      <Text style={styles.dateText}>
                        {new Date(item.dateVisited).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}
                      </Text>
                      <FontAwesome name="pencil" size={12} color="#ebebf5" style={{ marginLeft: 6, opacity: 0.7 }} />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.deleteLogButton} onPress={() => handleDeleteMemory(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <FontAwesome name="trash-o" size={16} color="#ff453a" />
                    </TouchableOpacity>
                  </View>

                  {editingLogId === item.id && Platform.OS === 'ios' && (
                      <View style={[styles.iosInlinePickerContainer, { marginTop: 8, marginBottom: 16 }]}>
                        <View style={styles.iosPickerHeader}>
                          <TouchableOpacity onPress={() => setEditingLogId(null)} style={{ flex: 1 }}>
                            <Text style={[styles.iosPickerDoneText, { color: '#ff453a' }]}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => submitEditedDate(item.id, editDate)}>
                            <Text style={styles.iosPickerDoneText}>Save</Text>
                          </TouchableOpacity>
                        </View>
                        <DateTimePicker
                            value={editDate}
                            mode="date"
                            display="spinner"
                            textColor="white"
                            themeVariant="dark"
                            onChange={(e, d) => d && setEditDate(d)}
                        />
                      </View>
                  )}

                  {editingLogId === item.id && Platform.OS === 'android' && (
                      <DateTimePicker
                          value={editDate}
                          mode="date"
                          display="default"
                          onChange={handleEditDateChangeAndroid}
                      />
                  )}

                  {item.photoUrls && item.photoUrls.length > 0 && (
                      <TouchableOpacity onPress={() => setExpandedImage(item.photoUrls[0])} activeOpacity={0.9}>
                        <Image source={{ uri: item.photoUrls[0] }} style={styles.memoryImage} resizeMode="cover" />
                      </TouchableOpacity>
                  )}
                  {item.notes ? <Text style={styles.noteText}>{item.notes}</Text> : null}
                </View>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No memories yet.</Text>}
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
      </BlurView>
  );
}

const styles = StyleSheet.create({
  container: { height: '85%', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  cityName: { fontSize: 22, fontWeight: 'bold', flex: 1, textAlign: 'center', marginHorizontal: 10, color: '#fff' },
  closeText: { fontSize: 16, color: '#0a84ff', fontWeight: '600' },
  backText: { fontSize: 16, color: '#0a84ff', fontWeight: '600' },

  savedPlaceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, marginBottom: 12, padding: 16 },
  savedPlaceContent: { flex: 1, marginRight: 10 },
  savedPlaceName: { fontSize: 18, fontWeight: '600', color: '#fff' },
  savedPlaceDate: { fontSize: 13, color: '#ebebf5', marginTop: 4, opacity: 0.7 },

  actionButtonsContainer: { flexDirection: 'row', alignItems: 'center' },
  actionButton: { padding: 8, marginLeft: 6, justifyContent: 'center', alignItems: 'center' },
  ratedBadge: { flexDirection: 'row', alignItems: 'center' },
  ratedNumber: { fontSize: 15, fontWeight: 'bold', color: '#fff', marginRight: 4 },

  inputArea: { marginBottom: 24, backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  input: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, minHeight: 60, maxHeight: 120, marginBottom: 12, fontSize: 16, color: '#fff' },

  // NEW: Multi-photo notice styles
  multiPhotoNotice: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 12, marginBottom: 12 },
  multiPhotoText: { color: '#ebebf5', fontSize: 13, flex: 1, lineHeight: 18 },

  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  leftActions: { flexDirection: 'row', flex: 1 },
  actionPillButton: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, alignItems: 'center', marginRight: 8 },
  actionPillText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  saveButton: { backgroundColor: '#0a84ff', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  saveButtonDisabled: { backgroundColor: 'rgba(10, 132, 255, 0.3)' },
  saveButtonText: { color: '#fff', fontWeight: 'bold' },

  // NEW: Horizontal grid styles for multiple thumbnails
  imagePreviewRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  imagePreviewContainer: { position: 'relative', marginRight: 12, marginBottom: 12 },
  imagePreview: { width: 70, height: 70, borderRadius: 10 },
  removeImageBtn: { position: 'absolute', top: -8, right: -8, backgroundColor: '#ff453a', width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#333' },

  logCard: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 16, marginBottom: 16 },
  logCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  editableDateContainer: { flexDirection: 'row', alignItems: 'center' },
  deleteLogButton: { padding: 4 },
  dateText: { fontSize: 14, color: '#ebebf5', opacity: 0.9, fontWeight: '600' },
  memoryImage: { width: '100%', height: 200, borderRadius: 12, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
  noteText: { fontSize: 16, color: '#fff', lineHeight: 22 },
  loader: { marginVertical: 20 },
  emptyText: { textAlign: 'center', color: '#8e8e93', marginTop: 30, fontSize: 16 },

  fullScreenImageContainer: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)', justifyContent: 'center', alignItems: 'center' },
  closeFullScreenButton: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 16 },
  fullScreenImage: { width: '100%', height: '100%' },

  alertBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  iosAlertBox: { width: 300, borderRadius: 24, overflow: 'hidden', padding: 20, backgroundColor: 'rgba(40,40,40,0.85)' },
  iosAlertHeader: { alignItems: 'center', marginBottom: 16 },
  iosAlertTitle: { fontSize: 18, fontWeight: '600', color: '#fff', textAlign: 'center', marginBottom: 8 },
  iosAlertSubtitle: { fontSize: 15, color: '#a0a0a5', textAlign: 'center', lineHeight: 20 },

  starsRow: { flexDirection: 'row', justifyContent: 'center', paddingBottom: 24 },
  starContainer: { width: 40, height: 40, marginHorizontal: 2, position: 'relative' },
  starIconWrapper: { position: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  starTouchZones: { flex: 1, flexDirection: 'row' },
  halfStarZone: { flex: 1, height: '100%' },

  iosAlertButtonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  iosAlertPillButton: { flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginHorizontal: 6 },
  iosAlertButtonTextCancel: { fontSize: 17, color: '#fff', fontWeight: '500' },
  iosAlertButtonTextConfirm: { fontSize: 17, color: '#0a84ff', fontWeight: '600' },

  iosInlinePickerContainer: { backgroundColor: 'rgba(30,30,30,0.8)', borderRadius: 16, marginBottom: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  iosPickerHeader: { flexDirection: 'row', justifyContent: 'flex-end', padding: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' },
  iosPickerDoneText: { color: '#0a84ff', fontSize: 16, fontWeight: 'bold' }
});