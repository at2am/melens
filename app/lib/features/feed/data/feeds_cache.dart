import 'dart:convert';

import 'package:logging/logging.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'feed_models.dart';

/// The user's feeds as this device last saw them, so the feed opens on them
/// while the agent service is asked again. Best effort: a read that fails is
/// a miss and a write that fails is skipped.
abstract interface class FeedsCache {
  /// The feeds last written, or null when there are none to trust.
  Future<List<FeedSubscription>?> read();

  Future<void> write(List<FeedSubscription> feeds);
}

/// [FeedsCache] in the platform's preferences: local storage on the web,
/// user defaults or shared preferences on phones. The device's anonymous
/// user does not change, so one entry serves it; a stale entry shows only
/// until the service answers.
final class PreferencesFeedsCache implements FeedsCache {
  PreferencesFeedsCache([SharedPreferencesAsync? preferences])
    : _preferences = preferences;

  static final _log = Logger('FeedsCache');

  /// Versioned, so a build that changes the feed's JSON starts afresh.
  static const _key = 'feeds.v1';

  SharedPreferencesAsync? _preferences;

  SharedPreferencesAsync get _store =>
      _preferences ??= SharedPreferencesAsync();

  @override
  Future<List<FeedSubscription>?> read() async {
    try {
      final stored = await _store.getString(_key);
      if (stored == null) return null;
      return [
        for (final feed in jsonDecode(stored) as List<dynamic>)
          FeedSubscription.fromJson(feed as Map<String, dynamic>),
      ];
    } on Object catch (error) {
      _log.fine('Reading the cached feeds failed', error);
      return null;
    }
  }

  @override
  Future<void> write(List<FeedSubscription> feeds) async {
    try {
      await _store.setString(
        _key,
        jsonEncode([for (final feed in feeds) feed.toJson()]),
      );
    } on Object catch (error) {
      _log.fine('Caching the feeds failed', error);
    }
  }
}
