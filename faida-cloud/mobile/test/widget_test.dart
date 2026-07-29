import 'package:faida_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('FaidaApp renders the home scaffold', (tester) async {
    await tester.pumpWidget(const FaidaApp());

    expect(find.text('Faida — Mama Lishe'), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
