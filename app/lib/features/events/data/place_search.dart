import 'dart:convert';

import '../../agent/data/agent_models.dart';
import 'place_search_stub.dart'
    if (dart.library.js_interop) 'place_search_web.dart'
    as platform;

/// One address or place the search offers.
final class PlaceSuggestion {
  const PlaceSuggestion({
    required this.placeId,
    required this.mainText,
    required this.secondaryText,
  });

  final String placeId;
  final String mainText;
  final String secondaryText;
}

/// Where a chosen place is, with the name and address Google returns.
final class PlaceLocation {
  const PlaceLocation({
    required this.point,
    required this.name,
    required this.address,
  });

  final AgentLatLng point;
  final String name;
  final String address;
}

/// Search is not possible on this platform or in this build, or the Places
/// API refused: the form tells the user why and keeps the other ways to pin.
final class PlaceSearchUnavailableException implements Exception {
  const PlaceSearchUnavailableException(this.message);

  final String message;

  @override
  String toString() => 'PlaceSearchUnavailableException: $message';
}

/// Address and place search for the event form (UC-09). On the Web it is the
/// Places library of the Maps JavaScript API, restricted to the service area
/// and biased to a point; elsewhere it is unavailable.
abstract interface class PlaceSearch {
  bool get isAvailable;

  /// At most a handful of suggestions for [query], nearest to [near] first.
  Future<List<PlaceSuggestion>> suggest(
    String query, {
    required AgentLatLng near,
  });

  /// The location of a suggestion.
  Future<PlaceLocation> resolve(String placeId);
}

/// The build has no browser Maps key, or this is not the Web.
final class UnavailablePlaceSearch implements PlaceSearch {
  const UnavailablePlaceSearch();

  @override
  bool get isAvailable => false;

  @override
  Future<List<PlaceSuggestion>> suggest(
    String query, {
    required AgentLatLng near,
  }) => Future.error(
    const PlaceSearchUnavailableException('Place search is not available.'),
  );

  @override
  Future<PlaceLocation> resolve(String placeId) => Future.error(
    const PlaceSearchUnavailableException('Place search is not available.'),
  );
}

/// The Web implementation over the helpers in `web/index.html`.
final class GooglePlaceSearch implements PlaceSearch {
  const GooglePlaceSearch();

  @override
  bool get isAvailable => platform.supportsPlaceSearch;

  @override
  Future<List<PlaceSuggestion>> suggest(
    String query, {
    required AgentLatLng near,
  }) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];
    final String json;
    try {
      json = await platform.searchPlaces(trimmed, near.lat, near.lng);
    } on Object catch (error) {
      throw PlaceSearchUnavailableException(_messageOf(error));
    }
    final Object? decoded = jsonDecode(json);
    if (decoded is! List<dynamic>) {
      throw const PlaceSearchUnavailableException('Unexpected search result.');
    }
    return [
      for (final item in decoded.whereType<Map<String, dynamic>>())
        if (item['placeId'] is String && (item['placeId'] as String).isNotEmpty)
          PlaceSuggestion(
            placeId: item['placeId'] as String,
            mainText: (item['mainText'] as String?) ?? '',
            secondaryText: (item['secondaryText'] as String?) ?? '',
          ),
    ];
  }

  @override
  Future<PlaceLocation> resolve(String placeId) async {
    final String json;
    try {
      json = await platform.resolvePlace(placeId);
    } on Object catch (error) {
      throw PlaceSearchUnavailableException(_messageOf(error));
    }
    final Object? decoded = jsonDecode(json);
    final lat = decoded is Map<String, dynamic> ? decoded['lat'] : null;
    final lng = decoded is Map<String, dynamic> ? decoded['lng'] : null;
    if (decoded is! Map<String, dynamic> || lat is! num || lng is! num) {
      throw const PlaceSearchUnavailableException('The place has no location.');
    }
    return PlaceLocation(
      point: AgentLatLng(lat: lat.toDouble(), lng: lng.toDouble()),
      name: (decoded['name'] as String?) ?? '',
      address: (decoded['address'] as String?) ?? '',
    );
  }

  /// The JavaScript error's text, without the Maps key that a URL may carry
  /// and without the RPC wrapper the Places library puts around it.
  static String _messageOf(Object error) {
    final text = error
        .toString()
        .replaceAll(RegExp(r'key=[^&\s]+'), 'key=…')
        .replaceFirst(RegExp(r'^(Error: )?RpcError\([A-Z_]+\): '), '')
        .trim();
    return text.isEmpty ? 'Place search failed.' : text;
  }
}
