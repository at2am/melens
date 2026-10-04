Future<void> loadGoogleMapsScript(String apiKey, String mapId) {
  return Future<void>.error(
    UnsupportedError(
      'The Maps JavaScript loader is Web-only. '
      'Native Maps keys require separate platform setup.',
    ),
  );
}
