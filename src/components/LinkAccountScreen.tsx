import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth } from '../config/firebaseConfig';
import { linkCoupleAccounts } from '../services/firestoreService';

interface Props {
  onLinked: () => void;
}

export default function LinkAccountScreen({ onLinked }: Props) {
  const [partnerCode, setPartnerCode] = useState('');
  const myCode = auth.currentUser?.uid || 'Loading...';

  const handleLink = async () => {
    if (!partnerCode.trim()) {
      Alert.alert('Error', 'Please enter a connection code.');
      return;
    }
    try {
      await linkCoupleAccounts(myCode, partnerCode.trim());
      onLinked();
    } catch (error: any) {
      Alert.alert('Link Failed', error.message);
    }
  };

  const handleSkip = async () => {
    try {
      // Temporarily link the user to themselves so the database queries still work
      await linkCoupleAccounts(myCode, myCode);
      onLinked();
    } catch (error: any) {
      Alert.alert('Skip Failed', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Link Accounts</Text>
      <Text style={styles.subtitle}>
        Share your connection code with your partner, or paste theirs below.
      </Text>
      
      <View style={styles.codeBox}>
        <Text style={styles.label}>Your Connection Code (Long Press to Copy):</Text>
        <Text style={styles.codeText} selectable>{myCode}</Text>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Paste partner's code here"
        value={partnerCode}
        onChangeText={setPartnerCode}
        autoCapitalize="none"
      />

      <TouchableOpacity style={styles.primaryButton} onPress={handleLink}>
        <Text style={styles.buttonText}>Connect Accounts</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={handleSkip}>
        <Text style={styles.secondaryButtonText}>Skip for now</Text>
      </TouchableOpacity>
    </View>
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
    fontSize: 32,
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
  codeBox: {
    backgroundColor: '#f0f8ff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#ccebff',
  },
  label: {
    fontSize: 14,
    color: '#005999',
    marginBottom: 8,
    fontWeight: '600',
  },
  codeText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
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
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
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
});