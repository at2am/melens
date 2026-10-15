import 'dart:async';

import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/data/feeds_client.dart';

/// The agent service's feed store for one user: [stored] is what a load
/// returns (null until the first save). [failure] makes the next calls
/// throw; [loadGate] holds the load until it completes.
final class FakeFeedsClient implements FeedsClient {
  FakeFeedsClient([this.stored]);

  List<FeedSubscription>? stored;
  Object? failure;
  Completer<void>? loadGate;
  final saves = <List<FeedSubscription>>[];
  int loads = 0;

  @override
  Future<List<FeedSubscription>?> load() async {
    loads++;
    await loadGate?.future;
    if (failure case final error?) throw error;
    return stored;
  }

  @override
  Future<List<FeedSubscription>> save(List<FeedSubscription> feeds) async {
    if (failure case final error?) throw error;
    // The service's round trip: what was sent comes back as JSON.
    final copy = [
      for (final feed in feeds) FeedSubscription.fromJson(feed.toJson()),
    ];
    saves.add(copy);
    stored = copy;
    return copy;
  }
}
