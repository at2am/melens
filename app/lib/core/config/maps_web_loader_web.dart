import 'dart:js_interop';

@JS('melensLoadGoogleMapsApi')
external JSPromise<JSAny?> _loadGoogleMapsApi(JSString apiKey, JSString mapId);

Future<void> loadGoogleMapsScript(String apiKey, String mapId) async {
  await _loadGoogleMapsApi(apiKey.toJS, mapId.toJS).toDart;
}
