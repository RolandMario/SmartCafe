import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTransaction } from '../../api/queries';
import { transactionApi } from '../../api/service';
import { Screen, Button, StatusBadge } from '../../components/ui';
import Receipt from '../../components/Receipt';
import { Colors, Font } from '../../constants/theme';
import { useState } from 'react';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [requerying, setRequerying] = useState(false);
  const { data: txn, isLoading } = useTransaction(id);

  const requery = async () => {
    if (!txn) return;
    setRequerying(true);
    try {
      await transactionApi.requery(txn._id);
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } finally {
      setRequerying(false);
    }
  };

  if (isLoading || !txn) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Transaction detail</Text>
      <StatusBadge status={txn.status} />

      <Receipt transaction={txn} />

      {txn.status === 'pending' ? (
        <Button title={requerying ? 'Requerying…' : 'Requery with vendor'} onPress={requery} loading={requerying} />
      ) : null}

      <Button title="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: Font.xl, fontWeight: '800', color: Colors.text },
});
