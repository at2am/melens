import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:logging/logging.dart';

/// Sends every log record to the console.
///
/// Each file declares its own logger, named after the file or class:
/// `final _log = Logger('AgentClient');`. Never use `print`.
void setUpLogging({required bool verbose}) {
  Logger.root.level = verbose ? Level.ALL : Level.INFO;
  Logger.root.onRecord.listen((record) {
    debugPrint(
      '${record.time.toIso8601String()} ${record.level.name} '
      '${record.loggerName}: ${record.message}',
    );
    if (record.error != null) debugPrint('  ${record.error}');
    if (record.stackTrace != null) debugPrint('${record.stackTrace}');
  });
}

/// Logs every provider that fails, so async errors are never silent.
final class LoggingProviderObserver extends ProviderObserver {
  const LoggingProviderObserver();

  static final _log = Logger('providers');

  @override
  void providerDidFail(
    ProviderObserverContext context,
    Object error,
    StackTrace stackTrace,
  ) {
    final provider = context.provider;
    _log.warning(
      '${provider.name ?? provider.runtimeType} failed',
      error,
      stackTrace,
    );
  }
}
