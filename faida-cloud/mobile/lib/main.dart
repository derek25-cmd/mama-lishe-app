import 'package:flutter/material.dart';

void main() => runApp(const FaidaApp());

class FaidaApp extends StatelessWidget {
  const FaidaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Faida',
      theme: ThemeData(colorSchemeSeed: Colors.green, useMaterial3: true),
      home: const Scaffold(body: Center(child: Text('Faida — Mama Lishe'))),
    );
  }
}
