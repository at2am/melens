bool get supportsPlaceSearch => false;

Future<String> searchPlaces(String query, double lat, double lng) =>
    Future.error(UnsupportedError('Place search needs the Web Maps API.'));

Future<String> resolvePlace(String placeId) =>
    Future.error(UnsupportedError('Place search needs the Web Maps API.'));
