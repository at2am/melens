import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/data/place_search.dart';

/// A scripted [PlaceSearch]: fixed suggestions, fixed locations, or a refusal.
final class FakePlaceSearch implements PlaceSearch {
  FakePlaceSearch({
    this.suggestions = const [],
    this.locations = const {},
    this.failure,
  });

  final List<PlaceSuggestion> suggestions;
  final Map<String, PlaceLocation> locations;

  /// When set, every call fails with this message.
  final String? failure;

  final List<String> queries = [];
  final List<String> resolved = [];

  @override
  bool get isAvailable => true;

  @override
  Future<List<PlaceSuggestion>> suggest(
    String query, {
    required AgentLatLng near,
  }) async {
    queries.add(query);
    if (failure != null) throw PlaceSearchUnavailableException(failure!);
    return suggestions;
  }

  @override
  Future<PlaceLocation> resolve(String placeId) async {
    resolved.add(placeId);
    if (failure != null) throw PlaceSearchUnavailableException(failure!);
    final location = locations[placeId];
    if (location == null) {
      throw const PlaceSearchUnavailableException('Unknown place.');
    }
    return location;
  }
}
