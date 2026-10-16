import 'dart:convert';

import 'package:logging/logging.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'map_models.dart';

/// The layer topic the map last showed and the layers switched on in each
/// topic.
typedef RememberedLayers = ({
  MapTopic topic,
  Map<MapTopic, Set<MapLayerId>> layers,
});

/// The map layers the user last had on, kept on this device so the map
/// opens on them again. Best effort: a read that fails is a miss and a write
/// that fails is skipped.
abstract interface class LayerMemory {
  /// The layers last written, or null when nothing is remembered.
  Future<RememberedLayers?> readLayers();

  Future<void> writeLayers(RememberedLayers layers);

  /// Whether user events (UC-09) were last drawn on the map, or null when
  /// nothing is remembered.
  Future<bool?> readCommunity();

  Future<void> writeCommunity({required bool enabled});
}

/// [LayerMemory] in the platform's preferences: local storage on the web,
/// user defaults or shared preferences on phones.
final class PreferencesLayerMemory implements LayerMemory {
  PreferencesLayerMemory([SharedPreferencesAsync? preferences])
    : _preferences = preferences;

  static final _log = Logger('LayerMemory');

  /// Versioned, so a build that changes the JSON starts afresh.
  static const _layersKey = 'map.layers.v1';
  static const _communityKey = 'map.community.v1';

  SharedPreferencesAsync? _preferences;

  SharedPreferencesAsync get _store =>
      _preferences ??= SharedPreferencesAsync();

  @override
  Future<RememberedLayers?> readLayers() async {
    try {
      final stored = await _store.getString(_layersKey);
      if (stored == null) return null;
      final json = jsonDecode(stored) as Map<String, dynamic>;
      final topics = MapTopic.values.asNameMap();
      final layerIds = MapLayerId.values.asNameMap();
      final topic = topics[json['topic']];
      if (topic == null) return null;
      // Names this build no longer knows are dropped, not fatal.
      return (
        topic: topic,
        layers: {
          for (final MapEntry(:key, :value)
              in (json['layers'] as Map<String, dynamic>).entries)
            ?topics[key]: {
              for (final name in value as List<dynamic>) ?layerIds[name],
            },
        },
      );
    } on Object catch (error) {
      _log.fine('Reading the remembered layers failed', error);
      return null;
    }
  }

  @override
  Future<void> writeLayers(RememberedLayers layers) async {
    try {
      await _store.setString(
        _layersKey,
        jsonEncode({
          'topic': layers.topic.name,
          'layers': {
            for (final MapEntry(:key, :value) in layers.layers.entries)
              key.name: [for (final layer in value) layer.name],
          },
        }),
      );
    } on Object catch (error) {
      _log.fine('Remembering the layers failed', error);
    }
  }

  @override
  Future<bool?> readCommunity() async {
    try {
      return await _store.getBool(_communityKey);
    } on Object catch (error) {
      _log.fine('Reading the remembered community layer failed', error);
      return null;
    }
  }

  @override
  Future<void> writeCommunity({required bool enabled}) async {
    try {
      await _store.setBool(_communityKey, enabled);
    } on Object catch (error) {
      _log.fine('Remembering the community layer failed', error);
    }
  }
}
