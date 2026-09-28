import 'package:material_ui/material_ui.dart';

/// Material 3 themes built from one seed colour.
///
/// The seed is a placeholder until the design is settled. Widgets read colours
/// from `Theme.of(context).colorScheme`, never from hard-coded values, so a
/// new seed restyles the whole app.
abstract final class AppTheme {
  static const _seed = Color(0xFF00696B);

  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) => ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: _seed, brightness: brightness),
  );
}
