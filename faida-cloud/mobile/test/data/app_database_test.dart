import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:faida_mobile/data/app_database.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late AppDatabase db;

  setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('inserts and reads back a pending sync item', () async {
    await db
        .into(db.pendingSyncItems)
        .insert(PendingSyncItemsCompanion.insert(
          clientId: '01HZY000000000000000000000',
          entityType: 'sale',
          payloadJson: '{"total_tzs": 5000}',
        ));

    final rows = await db.select(db.pendingSyncItems).get();
    expect(rows, hasLength(1));
    expect(rows.single.entityType, 'sale');
    expect(rows.single.synced, isFalse);
  });

  test('the unsynced-only query used by the sync worker filters correctly', () async {
    await db
        .into(db.pendingSyncItems)
        .insert(PendingSyncItemsCompanion.insert(
          clientId: 'synced-item',
          entityType: 'expense',
          payloadJson: '{}',
          synced: const Value(true),
        ));
    await db
        .into(db.pendingSyncItems)
        .insert(PendingSyncItemsCompanion.insert(
          clientId: 'unsynced-item',
          entityType: 'expense',
          payloadJson: '{}',
        ));

    final pending = await (db.select(db.pendingSyncItems)..where((t) => t.synced.equals(false))).get();
    expect(pending.map((r) => r.clientId), ['unsynced-item']);
  });
}
