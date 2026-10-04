import 'env.dart';
import 'maps_web_loader_stub.dart'
    if (dart.library.js_interop) 'maps_web_loader_web.dart'
    as platform;

typedef MapsScriptLoader = Future<void> Function(String apiKey, String mapId);

/// Loads the browser SDK before constructing a GoogleMap widget.
///
/// Keep one instance in a provider. Maps key readiness is independent of the
/// live/sample data choice; both modes require a real configured base map key.
final class GoogleMapsWebApiLoader {
  GoogleMapsWebApiLoader({MapsScriptLoader? loadScript})
    : _loadScript = loadScript ?? platform.loadGoogleMapsScript;

  final MapsScriptLoader _loadScript;
  Future<void>? _pending;

  Future<void> load(Env env) {
    if (!env.hasGoogleMapsWebApiKey) {
      return Future<void>.error(
        StateError('GOOGLE_MAPS_WEB_API_KEY is required for the Web map.'),
      );
    }
    return _pending ??=
        Future<void>.sync(
          () => _loadScript(env.googleMapsWebApiKey, env.googleMapsMapId),
        ).then<void>(
          (_) {},
          onError: (Object error, StackTrace stack) {
            _pending = null;
            Error.throwWithStackTrace(error, stack);
          },
        );
  }
}
