import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { theme } from '@/src/lib/theme';
import { reportUser, REPORT_REASONS } from '@/src/lib/moderation';
import type { ReportReason } from '@/src/lib/moderation';

interface Target {
  userId: string;
  label: string;
}

interface Props {
  visible: boolean;
  reporterId: string;
  target: Target | null;
  onClose: () => void;
  onSubmitted?: () => void;
}

export default function ReportModal({ visible, reporterId, target, onClose, onSubmitted }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setReason(null);
    setDetails('');
    setSubmitting(false);
  }

  async function handleSubmit() {
    if (!target || !reason) return;
    setSubmitting(true);
    try {
      await reportUser(reporterId, target.userId, reason, details);
      reset();
      onClose();
      onSubmitted?.();
      Alert.alert('Report submitted', 'Thanks — we\'ll review it as soon as we can.');
    } catch (e: any) {
      setSubmitting(false);
      Alert.alert('Could not submit', e.message || 'Please try again.');
    }
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Report</Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={styles.body}>
          <Text style={styles.targetLabel} numberOfLines={2}>
            Reporting user: <Text style={styles.targetStrong}>{target?.label}</Text>
          </Text>

          <Text style={styles.sectionTitle}>Reason</Text>
          <View style={styles.reasons}>
            {REPORT_REASONS.map(r => {
              const selected = reason === r.value;
              return (
                <Pressable
                  key={r.value}
                  style={({ pressed }) => [
                    styles.reasonRow,
                    selected && styles.reasonRowSelected,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setReason(r.value)}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected && <FontAwesome name="check" size={10} color="#fff" />}
                  </View>
                  <Text style={[styles.reasonLabel, selected && styles.reasonLabelSelected]}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Additional details (optional)</Text>
          <TextInput
            style={styles.detailsInput}
            placeholder="Any extra context for us"
            placeholderTextColor={theme.textFaint}
            value={details}
            onChangeText={setDetails}
            multiline
            numberOfLines={4}
            maxLength={500}
            textAlignVertical="top"
          />

          <Pressable
            style={({ pressed }) => [
              styles.submit,
              (!reason || submitting) && styles.submitDisabled,
              pressed && reason && !submitting && { opacity: 0.85 },
            ]}
            onPress={handleSubmit}
            disabled={!reason || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Submit report</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  cancel: {
    fontSize: 15,
    color: theme.accent,
    fontFamily: 'DMSans_500Medium',
    width: 60,
  },
  title: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  targetLabel: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    marginBottom: 20,
    lineHeight: 18,
  },
  targetStrong: {
    color: theme.text,
    fontFamily: 'DMSans_600SemiBold',
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 6,
  },
  reasons: {
    marginBottom: 20,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: theme.bgCard,
    marginBottom: 8,
    gap: 12,
  },
  reasonRowSelected: {
    backgroundColor: 'rgba(255,107,53,0.1)',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: theme.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  reasonLabel: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
  },
  reasonLabelSelected: {
    fontFamily: 'DMSans_600SemiBold',
  },
  detailsInput: {
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: theme.text,
    minHeight: 90,
    marginBottom: 24,
  },
  submit: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
  },
});
