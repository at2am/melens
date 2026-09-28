import 'dart:ui';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:logging/logging.dart';

import '../core/config/env.dart';
import '../core/logging/logging.dart';
import 'app.dart';

final _log = Logger('bootstrap');

/// Starts the app: logging, global error handlers, then the provider scope.
///
/// Everything the app needs before the first frame goes here. Services that
/// can start lazily belong in a provider instead.
void bootstrap() {
  WidgetsFlutterBinding.ensureInitialized();

  // Web URLs without `#`. Firebase Hosting must rewrite every path to
  // index.html.
  usePathUrlStrategy();

  final env = Env.fromDefines;
  setUpLogging(verbose: env.isDev);
  _log.info('Starting Melens (${env.name}), agent at ${env.agentBaseUrl}');

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    _log.severe('Flutter error', details.exception, details.stack);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    _log.severe('Uncaught error', error, stack);
    return true;
  };

  runApp(
    ProviderScope(
      observers: [LoggingProviderObserver()],
      child: const MelensApp(),
    ),
  );
}
