import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../features/shell/state/shell_providers.dart';
import '../l10n/app_localizations.dart';
import 'router.dart';
import 'theme.dart';

/// The app's only locale. UI text is English because Maps grounding supports
/// English only (AGENTS.md, Product rules); `en_AU` gives Melbourne date,
/// time and number formats.
const appLocale = Locale('en', 'AU');

class MelensApp extends ConsumerWidget {
  const MelensApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: switch (ref.watch(appThemeSettingProvider)) {
        AppThemeChoice.system => ThemeMode.system,
        AppThemeChoice.light => ThemeMode.light,
        AppThemeChoice.dark => ThemeMode.dark,
      },
      locale: appLocale,
      supportedLocales: const [appLocale],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        ...GlobalMaterialLocalizations.delegates,
      ],
      routerConfig: ref.watch(routerProvider),
    );
  }
}
