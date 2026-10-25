import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth } from '../config/firebaseConfig';
import { createSoloCouple, InviteError, joinWithInvite } from '../services/firestoreService';

interface Props {
  onLinked: (coupleId: string) => void;
}

export default function LinkAccountScreen({ onLinked }: Props) {
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);

  const handleJoin = async () => {
    const user = auth.currentUser;
    if (!user || !inviteCode.trim()) {
      Alert.alert('Enter a code', 'Paste the invite code your partner sent you.');
      return;
    }
    setBusy(true);
    try {
      onLinked(await joinWithInvite(user.uid, user.email || '', inviteCode));
    } catch (error: any) {
      Alert.alert(error instanceof InviteError ? 'Cannot use this code' : 'Could not join', error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStartAlone = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setBusy(true);
    try {
      onLinked(await createSoloCouple(user.uid, user.email || ''));
    } catch (error: any) {
      Alert.alert('Could not start', error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <Text style={styles.title}>Connect with your partner</Text>
      <Text style={styles.subtitle}>
        Enter the invite code your partner created in the app menu (Sync tab). Codes work once and expire after 24 hours.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Invite code, for example K7M2P-9XQ4T"
        value={inviteCode}
        onChangeText={setInviteCode}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!busy}
      />

      <TouchableOpacity style={[styles.primaryButton, busy && styles.disabled]} onPress={handleJoin} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Join with code</Text>}
      </TouchableOpacity>

      <Text style={styles.or}>or</Text>

      <TouchableOpacity style={styles.secondaryButton} onPress={handleStartAlone} disabled={busy}>
        <Text style={styles.secondaryButtonText}>Start on my own</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>You can invite your partner later from the menu.</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 22,
  },
  input: {
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 16,
  },
  primaryButton: {
    backgroundColor: '#34c759',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  disabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  or: {
    textAlign: 'center',
    color: '#999',
    marginVertical: 8,
  },
  secondaryButton: {
    padding: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    textAlign: 'center',
    color: '#999',
    fontSize: 13,
  },
});
