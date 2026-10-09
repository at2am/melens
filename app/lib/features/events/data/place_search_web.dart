import 'dart:js_interop';

@JS('melensSearchPlaces')
external JSPromise<JSString> _searchPlaces(
  JSString query,
  JSNumber lat,
  JSNumber lng,
);

@JS('melensResolvePlace')
external JSPromise<JSString> _resolvePlace(JSString placeId);

bool get supportsPlaceSearch => true;

Future<String> searchPlaces(String query, double lat, double lng) async =>
    (await _searchPlaces(query.toJS, lat.toJS, lng.toJS).toDart).toDart;

Future<String> resolvePlace(String placeId) async =>
    (await _resolvePlace(placeId.toJS).toDart).toDart;
