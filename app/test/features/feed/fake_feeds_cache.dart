import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/data/feeds_cache.dart';

/// This device's cached feeds: [stored] is what a read returns (null when
/// nothing is cached), and each write replaces it.
final class FakeFeedsCache implements FeedsCache {
  FakeFeedsCache([this.stored]);

  List<FeedSubscription>? stored;
  final writes = <List<FeedSubscription>>[];

  @override
  Future<List<FeedSubscription>?> read() async => stored;

  @override
  Future<void> write(List<FeedSubscription> feeds) async {
    writes.add(feeds);
    stored = feeds;
  }
}
