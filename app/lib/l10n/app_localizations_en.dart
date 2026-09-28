// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Melens';

  @override
  String get mapPlaceholder => 'The map goes here (UC-01).';

  @override
  String get notFoundTitle => 'Page not found';

  @override
  String get notFoundBackToMap => 'Back to the map';
}
