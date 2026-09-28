import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../features/map/ui/map_screen.dart';
import '../l10n/app_localizations.dart';

part 'router.g.dart';

/// Every route path in the app. Navigate with these, never with string
/// literals: `context.go(AppRoutes.map)`.
abstract final class AppRoutes {
  static const map = '/';
}

/// The app's router. It is a provider so that redirects can later watch app
/// state, for example the auth state for UC-07 and UC-09.
@Riverpod(keepAlive: true)
GoRouter router(Ref ref) {
  final router = GoRouter(
    debugLogDiagnostics: kDebugMode,
    routes: [
      GoRoute(
        path: AppRoutes.map,
        builder: (context, state) => const MapScreen(),
      ),
    ],
    errorBuilder: (context, state) => const _NotFoundScreen(),
  );
  ref.onDispose(router.dispose);
  return router;
}

class _NotFoundScreen extends StatelessWidget {
  const _NotFoundScreen();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.notFoundTitle)),
      body: Center(
        child: FilledButton(
          onPressed: () => context.go(AppRoutes.map),
          child: Text(l10n.notFoundBackToMap),
        ),
      ),
    );
  }
}
