import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

/// Offline-first local cache. Mirrors DOC 02 §6.6 #24 (Offline Support):
/// a vendor's daily loop — sales, expenses, cook plans — must work with no
/// network, syncing to the backend's /api/v1/sync/* endpoints once online.
class PendingSyncItems extends Table {
  TextColumn get clientId => text()(); // ULID, the idempotency key on sync
  TextColumn get entityType => text()(); // "sale" | "expense" | "cook_plan" | ...
  TextColumn get payloadJson => text()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  BoolColumn get synced => boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {clientId};
}

@DriftDatabase(tables: [PendingSyncItems])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());
  AppDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 1;
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'faida.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
