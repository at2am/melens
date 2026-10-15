import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../features/events/state/event_view_providers.dart';
import '../features/feed/ui/feed_screen.dart';
import '../features/map/ui/map_screen.dart';
import '../features/settings/ui/settings_screen.dart';
import '../features/shell/ui/app_shell.dart';
import '../l10n/app_localizations.dart';

part 'router.g.dart';

/// The bottom tabs, in the order of the navigation bar.
enum AppBranch { feed, discover, settings }

/// Every route path in the app. Navigate with these, never with string
/// literals: `context.go(AppRoutes.discover)`.
abstract final class AppRoutes {
  static const feed = '/';
  static const discover = '/discover';
  static const settings = '/settings';
  static const eventPattern = '/events/:id';

  static String event(String id) => '/events/${Uri.encodeComponent(id)}';
}

/// The app's router. It is a provider so that redirects can later watch app
/// state, for example the auth state for UC-07 and UC-09.
///
/// The three tabs are branches of one stateful shell, so each keeps its scroll
/// position and the map keeps its camera while the user is elsewhere. Event
/// links (`/events/:id`, the address an invite carries) open that event in the
/// events panel on the Discover tab.
@Riverpod(keepAlive: true)
GoRouter router(Ref ref) {
  final router = GoRouter(
    debugLogDiagnostics: kDebugMode,
    routes: [
      GoRoute(
        path: AppRoutes.eventPattern,
        redirect: (context, state) {
          final id = state.pathParameters['id'];
          // Not during the redirect itself: a provider must not change
          // another while the router is being built.
          if (id != null) {
            Future.microtask(
              () => ref.read(eventsPanelRequestsProvider.notifier).openEvent(id),
            );
          }
          return AppRoutes.discover;
        },
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.feed,
                builder: (context, state) => const FeedScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.discover,
                builder: (context, state) => const MapScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.settings,
                builder: (context, state) => const SettingsScreen(),
              ),
            ],
          ),
        ],
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
          onPressed: () => context.go(AppRoutes.feed),
          child: Text(l10n.notFoundBackToFeed),
        ),
      ),
    );
  }
}
