import 'package:material_ui/material_ui.dart';

/// A minimal Material 3 look: white (or near-black) surfaces, one teal
/// accent, flat tonal cards with generous radii and no shadows except on the
/// floating button.
///
/// Widgets read colours and shapes from the theme, never from hard-coded
/// values, so a new seed or radius restyles the whole app.
abstract final class AppTheme {
  static const _seed = Color(0xFF00696B);

  /// Corner radius shared by cards, inputs and sheets.
  static const radius = 20.0;

  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final base = ColorScheme.fromSeed(seedColor: _seed, brightness: brightness);
    final light = brightness == Brightness.light;
    final scheme = base.copyWith(
      surface: light ? const Color(0xFFFFFFFF) : const Color(0xFF0E1111),
      surfaceContainerLow: light
          ? const Color(0xFFF4F7F7)
          : const Color(0xFF161A1A),
      surfaceContainer: light
          ? const Color(0xFFEEF2F2)
          : const Color(0xFF1B2020),
    );
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
    );
    final text = Typography.material2021().black.apply(
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
    );
    return ThemeData(
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
      textTheme: light
          ? text
          : Typography.material2021().white.apply(
              bodyColor: scheme.onSurface,
              displayColor: scheme.onSurface,
            ),
      appBarTheme: AppBarThemeData(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: text.headlineSmall?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        color: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        shape: shape,
        clipBehavior: Clip.antiAlias,
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 68,
        elevation: 0,
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.secondaryContainer,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        elevation: 3,
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      chipTheme: ChipThemeData(
        side: BorderSide(color: scheme.outlineVariant),
        shape: const StadiumBorder(),
        showCheckmark: false,
        backgroundColor: Colors.transparent,
        selectedColor: scheme.secondaryContainer,
        labelStyle: text.labelLarge,
      ),
      inputDecorationTheme: InputDecorationThemeData(
        filled: true,
        fillColor: scheme.surfaceContainerLow,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(0, 48),
          shape: const StadiumBorder(),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 48),
          shape: const StadiumBorder(),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant,
        space: 1,
        thickness: 1,
      ),
      listTileTheme: const ListTileThemeData(
        contentPadding: EdgeInsets.symmetric(horizontal: 4),
      ),
    );
  }
}
