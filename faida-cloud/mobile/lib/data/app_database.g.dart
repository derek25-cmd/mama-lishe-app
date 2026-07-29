// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $PendingSyncItemsTable extends PendingSyncItems
    with TableInfo<$PendingSyncItemsTable, PendingSyncItem> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingSyncItemsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientIdMeta =
      const VerificationMeta('clientId');
  @override
  late final GeneratedColumn<String> clientId = GeneratedColumn<String>(
      'client_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _entityTypeMeta =
      const VerificationMeta('entityType');
  @override
  late final GeneratedColumn<String> entityType = GeneratedColumn<String>(
      'entity_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _payloadJsonMeta =
      const VerificationMeta('payloadJson');
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
      'payload_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  static const VerificationMeta _syncedMeta = const VerificationMeta('synced');
  @override
  late final GeneratedColumn<bool> synced = GeneratedColumn<bool>(
      'synced', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("synced" IN (0, 1))'),
      defaultValue: const Constant(false));
  @override
  List<GeneratedColumn> get $columns =>
      [clientId, entityType, payloadJson, createdAt, synced];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_sync_items';
  @override
  VerificationContext validateIntegrity(Insertable<PendingSyncItem> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_id')) {
      context.handle(_clientIdMeta,
          clientId.isAcceptableOrUnknown(data['client_id']!, _clientIdMeta));
    } else if (isInserting) {
      context.missing(_clientIdMeta);
    }
    if (data.containsKey('entity_type')) {
      context.handle(
          _entityTypeMeta,
          entityType.isAcceptableOrUnknown(
              data['entity_type']!, _entityTypeMeta));
    } else if (isInserting) {
      context.missing(_entityTypeMeta);
    }
    if (data.containsKey('payload_json')) {
      context.handle(
          _payloadJsonMeta,
          payloadJson.isAcceptableOrUnknown(
              data['payload_json']!, _payloadJsonMeta));
    } else if (isInserting) {
      context.missing(_payloadJsonMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    }
    if (data.containsKey('synced')) {
      context.handle(_syncedMeta,
          synced.isAcceptableOrUnknown(data['synced']!, _syncedMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientId};
  @override
  PendingSyncItem map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingSyncItem(
      clientId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}client_id'])!,
      entityType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}entity_type'])!,
      payloadJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}payload_json'])!,
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
      synced: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}synced'])!,
    );
  }

  @override
  $PendingSyncItemsTable createAlias(String alias) {
    return $PendingSyncItemsTable(attachedDatabase, alias);
  }
}

class PendingSyncItem extends DataClass implements Insertable<PendingSyncItem> {
  final String clientId;
  final String entityType;
  final String payloadJson;
  final DateTime createdAt;
  final bool synced;
  const PendingSyncItem(
      {required this.clientId,
      required this.entityType,
      required this.payloadJson,
      required this.createdAt,
      required this.synced});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_id'] = Variable<String>(clientId);
    map['entity_type'] = Variable<String>(entityType);
    map['payload_json'] = Variable<String>(payloadJson);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['synced'] = Variable<bool>(synced);
    return map;
  }

  PendingSyncItemsCompanion toCompanion(bool nullToAbsent) {
    return PendingSyncItemsCompanion(
      clientId: Value(clientId),
      entityType: Value(entityType),
      payloadJson: Value(payloadJson),
      createdAt: Value(createdAt),
      synced: Value(synced),
    );
  }

  factory PendingSyncItem.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingSyncItem(
      clientId: serializer.fromJson<String>(json['clientId']),
      entityType: serializer.fromJson<String>(json['entityType']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      synced: serializer.fromJson<bool>(json['synced']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientId': serializer.toJson<String>(clientId),
      'entityType': serializer.toJson<String>(entityType),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'synced': serializer.toJson<bool>(synced),
    };
  }

  PendingSyncItem copyWith(
          {String? clientId,
          String? entityType,
          String? payloadJson,
          DateTime? createdAt,
          bool? synced}) =>
      PendingSyncItem(
        clientId: clientId ?? this.clientId,
        entityType: entityType ?? this.entityType,
        payloadJson: payloadJson ?? this.payloadJson,
        createdAt: createdAt ?? this.createdAt,
        synced: synced ?? this.synced,
      );
  PendingSyncItem copyWithCompanion(PendingSyncItemsCompanion data) {
    return PendingSyncItem(
      clientId: data.clientId.present ? data.clientId.value : this.clientId,
      entityType:
          data.entityType.present ? data.entityType.value : this.entityType,
      payloadJson:
          data.payloadJson.present ? data.payloadJson.value : this.payloadJson,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      synced: data.synced.present ? data.synced.value : this.synced,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingSyncItem(')
          ..write('clientId: $clientId, ')
          ..write('entityType: $entityType, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('createdAt: $createdAt, ')
          ..write('synced: $synced')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(clientId, entityType, payloadJson, createdAt, synced);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingSyncItem &&
          other.clientId == this.clientId &&
          other.entityType == this.entityType &&
          other.payloadJson == this.payloadJson &&
          other.createdAt == this.createdAt &&
          other.synced == this.synced);
}

class PendingSyncItemsCompanion extends UpdateCompanion<PendingSyncItem> {
  final Value<String> clientId;
  final Value<String> entityType;
  final Value<String> payloadJson;
  final Value<DateTime> createdAt;
  final Value<bool> synced;
  final Value<int> rowid;
  const PendingSyncItemsCompanion({
    this.clientId = const Value.absent(),
    this.entityType = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.synced = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  PendingSyncItemsCompanion.insert({
    required String clientId,
    required String entityType,
    required String payloadJson,
    this.createdAt = const Value.absent(),
    this.synced = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : clientId = Value(clientId),
        entityType = Value(entityType),
        payloadJson = Value(payloadJson);
  static Insertable<PendingSyncItem> custom({
    Expression<String>? clientId,
    Expression<String>? entityType,
    Expression<String>? payloadJson,
    Expression<DateTime>? createdAt,
    Expression<bool>? synced,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientId != null) 'client_id': clientId,
      if (entityType != null) 'entity_type': entityType,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (createdAt != null) 'created_at': createdAt,
      if (synced != null) 'synced': synced,
      if (rowid != null) 'rowid': rowid,
    });
  }

  PendingSyncItemsCompanion copyWith(
      {Value<String>? clientId,
      Value<String>? entityType,
      Value<String>? payloadJson,
      Value<DateTime>? createdAt,
      Value<bool>? synced,
      Value<int>? rowid}) {
    return PendingSyncItemsCompanion(
      clientId: clientId ?? this.clientId,
      entityType: entityType ?? this.entityType,
      payloadJson: payloadJson ?? this.payloadJson,
      createdAt: createdAt ?? this.createdAt,
      synced: synced ?? this.synced,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientId.present) {
      map['client_id'] = Variable<String>(clientId.value);
    }
    if (entityType.present) {
      map['entity_type'] = Variable<String>(entityType.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (synced.present) {
      map['synced'] = Variable<bool>(synced.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingSyncItemsCompanion(')
          ..write('clientId: $clientId, ')
          ..write('entityType: $entityType, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('createdAt: $createdAt, ')
          ..write('synced: $synced, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $PendingSyncItemsTable pendingSyncItems =
      $PendingSyncItemsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [pendingSyncItems];
}

typedef $$PendingSyncItemsTableCreateCompanionBuilder
    = PendingSyncItemsCompanion Function({
  required String clientId,
  required String entityType,
  required String payloadJson,
  Value<DateTime> createdAt,
  Value<bool> synced,
  Value<int> rowid,
});
typedef $$PendingSyncItemsTableUpdateCompanionBuilder
    = PendingSyncItemsCompanion Function({
  Value<String> clientId,
  Value<String> entityType,
  Value<String> payloadJson,
  Value<DateTime> createdAt,
  Value<bool> synced,
  Value<int> rowid,
});

class $$PendingSyncItemsTableFilterComposer
    extends Composer<_$AppDatabase, $PendingSyncItemsTable> {
  $$PendingSyncItemsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientId => $composableBuilder(
      column: $table.clientId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get synced => $composableBuilder(
      column: $table.synced, builder: (column) => ColumnFilters(column));
}

class $$PendingSyncItemsTableOrderingComposer
    extends Composer<_$AppDatabase, $PendingSyncItemsTable> {
  $$PendingSyncItemsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientId => $composableBuilder(
      column: $table.clientId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get synced => $composableBuilder(
      column: $table.synced, builder: (column) => ColumnOrderings(column));
}

class $$PendingSyncItemsTableAnnotationComposer
    extends Composer<_$AppDatabase, $PendingSyncItemsTable> {
  $$PendingSyncItemsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientId =>
      $composableBuilder(column: $table.clientId, builder: (column) => column);

  GeneratedColumn<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => column);

  GeneratedColumn<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<bool> get synced =>
      $composableBuilder(column: $table.synced, builder: (column) => column);
}

class $$PendingSyncItemsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $PendingSyncItemsTable,
    PendingSyncItem,
    $$PendingSyncItemsTableFilterComposer,
    $$PendingSyncItemsTableOrderingComposer,
    $$PendingSyncItemsTableAnnotationComposer,
    $$PendingSyncItemsTableCreateCompanionBuilder,
    $$PendingSyncItemsTableUpdateCompanionBuilder,
    (
      PendingSyncItem,
      BaseReferences<_$AppDatabase, $PendingSyncItemsTable, PendingSyncItem>
    ),
    PendingSyncItem,
    PrefetchHooks Function()> {
  $$PendingSyncItemsTableTableManager(
      _$AppDatabase db, $PendingSyncItemsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingSyncItemsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PendingSyncItemsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PendingSyncItemsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> clientId = const Value.absent(),
            Value<String> entityType = const Value.absent(),
            Value<String> payloadJson = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
            Value<bool> synced = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              PendingSyncItemsCompanion(
            clientId: clientId,
            entityType: entityType,
            payloadJson: payloadJson,
            createdAt: createdAt,
            synced: synced,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String clientId,
            required String entityType,
            required String payloadJson,
            Value<DateTime> createdAt = const Value.absent(),
            Value<bool> synced = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              PendingSyncItemsCompanion.insert(
            clientId: clientId,
            entityType: entityType,
            payloadJson: payloadJson,
            createdAt: createdAt,
            synced: synced,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$PendingSyncItemsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $PendingSyncItemsTable,
    PendingSyncItem,
    $$PendingSyncItemsTableFilterComposer,
    $$PendingSyncItemsTableOrderingComposer,
    $$PendingSyncItemsTableAnnotationComposer,
    $$PendingSyncItemsTableCreateCompanionBuilder,
    $$PendingSyncItemsTableUpdateCompanionBuilder,
    (
      PendingSyncItem,
      BaseReferences<_$AppDatabase, $PendingSyncItemsTable, PendingSyncItem>
    ),
    PendingSyncItem,
    PrefetchHooks Function()>;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$PendingSyncItemsTableTableManager get pendingSyncItems =>
      $$PendingSyncItemsTableTableManager(_db, _db.pendingSyncItems);
}
