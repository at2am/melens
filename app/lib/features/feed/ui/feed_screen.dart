import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../events/state/event_view_providers.dart';
import '../../shell/state/shell_providers.dart';
import '../data/feed_models.dart';
import '../state/feed_providers.dart';
import 'feed_labels.dart';

/// The home tab: what is happening in the user's feeds. A chip per feed
/// narrows the list to one; the feed refreshes by pulling down.
class FeedScreen extends ConsumerWidget {
  const FeedScreen({super.key});

  /// The feed and the sources it reads: they do not retry on their own, so
  /// a source that failed once keeps its error until it is invalidated too.
  static void _refresh(WidgetRef ref) {
    if (ref.read(feedSubscriptionsProvider).hasError) {
      ref.invalidate(feedSubscriptionsProvider);
    }
    ref
      ..invalidate(feedCommunityEventsProvider)
      ..invalidate(mapFeedItemsProvider)
      ..invalidate(feedProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final feeds = ref.watch(feedSubscriptionsProvider);
    final enabled = [
      for (final feed in feeds.value ?? const <FeedSubscription>[])
        if (feed.enabled) feed,
    ];
    final picked = ref.watch(selectedFeedProvider);
    // A paused or deleted feed's chip is gone; show every feed instead.
    final selected = enabled.any((feed) => feed.id == picked) ? picked : null;
    final today = DateFormat('EEEE d MMMM', 'en_AU').format(clock.now());

    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        onRefresh: () async {
          _refresh(ref);
          await ref.read(feedProvider.future).catchError((Object _) {
            return const FeedResult(items: []);
          });
        },
        child: CustomScrollView(
          key: const ValueKey('feed-scroll'),
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 12, 0),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            today,
                            style: theme.textTheme.labelLarge?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            strings.feedTitle,
                            style: theme.textTheme.displaySmall?.copyWith(
                              fontWeight: FontWeight.w800,
                              letterSpacing: -1,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton.filledTonal(
                      key: const ValueKey('feed-host-event'),
                      tooltip: strings.feedHostEvent,
                      onPressed: () {
                        ref
                            .read(eventsPanelRequestsProvider.notifier)
                            .startNewEvent();
                        context.go(AppRoutes.discover);
                      },
                      icon: const Icon(Icons.event_outlined),
                    ),
                    const SizedBox(width: 4),
                    IconButton.filledTonal(
                      key: const ValueKey('feed-new'),
                      tooltip: strings.feedNew,
                      onPressed: feeds.hasValue
                          ? () => context.push(AppRoutes.newFeed)
                          : null,
                      icon: const Icon(Icons.add),
                    ),
                  ],
                ),
              ),
            ),
            if (enabled.isNotEmpty)
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 64,
                  child: ListView(
                    key: const ValueKey('feed-chips'),
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 12,
                    ),
                    children: [
                      ChoiceChip(
                        key: const ValueKey('feed-chip-all'),
                        label: Text(strings.feedChipAll),
                        selected: selected == null,
                        onSelected: (_) => ref
                            .read(selectedFeedProvider.notifier)
                            .select(null),
                      ),
                      const SizedBox(width: 8),
                      for (final feed in enabled) ...[
                        ChoiceChip(
                          key: ValueKey('feed-chip-${feed.id}'),
                          avatar: Icon(feedScopeIcon(feed.scope), size: 18),
                          label: Text(feed.name),
                          selected: selected == feed.id,
                          onSelected: (_) => ref
                              .read(selectedFeedProvider.notifier)
                              .select(feed.id),
                        ),
                        const SizedBox(width: 8),
                      ],
                      ActionChip(
                        key: const ValueKey('feed-manage'),
                        avatar: const Icon(Icons.tune, size: 18),
                        label: Text(strings.feedManage),
                        onPressed: () => context.go(AppRoutes.settings),
                      ),
                    ],
                  ),
                ),
              ),
            ..._body(context, ref, feeds, enabled, selected),
            const SliverToBoxAdapter(child: SizedBox(height: 96)),
          ],
        ),
      ),
    );
  }

  List<Widget> _body(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<List<FeedSubscription>> feeds,
    List<FeedSubscription> enabled,
    String? selected,
  ) {
    final strings = AppLocalizations.of(context);
    Widget fill(Widget child) =>
        SliverFillRemaining(hasScrollBody: false, child: child);
    const spinner = Center(child: CircularProgressIndicator());

    final list = feeds.value;
    if (list == null) {
      return [
        if (feeds.hasError)
          fill(
            _Message(
              icon: Icons.cloud_off,
              title: strings.feedError,
              actionLabel: strings.feedRetry,
              onAction: () => _refresh(ref),
            ),
          )
        else
          fill(spinner),
      ];
    }
    if (list.isEmpty) {
      return [
        fill(
          _Message(
            icon: Icons.dynamic_feed_outlined,
            title: strings.feedEmptyNoFeeds,
            body: strings.feedEmptyNoFeedsBody,
            actionLabel: strings.feedCreate,
            onAction: () => context.push(AppRoutes.newFeed),
          ),
        ),
      ];
    }
    if (enabled.isEmpty) {
      return [
        fill(
          _Message(
            icon: Icons.pause_circle_outline,
            title: strings.feedAllPaused,
            body: strings.feedAllPausedBody,
            actionLabel: strings.feedManage,
            onAction: () => context.go(AppRoutes.settings),
          ),
        ),
      ];
    }

    final names = {for (final feed in enabled) feed.id: feed.name};
    bool shown(String feedId) => selected == null || selected == feedId;
    // A source arriving rebuilds the feed; it keeps showing what it has.
    return ref
        .watch(feedProvider)
        .when(
          skipLoadingOnReload: true,
          loading: () => [fill(spinner)],
          error: (error, stack) => [
            fill(
              _Message(
                icon: Icons.cloud_off,
                title: strings.feedError,
                actionLabel: strings.feedRetry,
                onAction: () => _refresh(ref),
              ),
            ),
          ],
          data: (result) {
            final items = [
              for (final item in result.items)
                if (item.feedIds.any(shown)) item,
            ];
            final failed = [
              for (final source in result.failedSources)
                if (shown(source.feedId))
                  strings.feedSourceName(
                    names[source.feedId] ?? '',
                    feedTopicTitle(strings, source.topic),
                  ),
            ];
            final loading = result.loadingSources.any(
              (source) => shown(source.feedId),
            );
            return [
              if (loading && items.isNotEmpty)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(20, 0, 20, 12),
                    child: LinearProgressIndicator(
                      key: ValueKey('feed-source-loading'),
                    ),
                  ),
                ),
              if (failed.isNotEmpty)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                    child: Text(
                      strings.feedSourceFailed(failed.join(', ')),
                      key: const ValueKey('feed-source-failed'),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                ),
              if (items.isEmpty && loading)
                fill(spinner)
              else if (items.isEmpty)
                fill(
                  _Message(
                    icon: Icons.nightlight_outlined,
                    title: strings.feedEmpty,
                    body: strings.feedEmptyBody,
                    actionLabel: strings.feedManage,
                    onAction: () => context.go(AppRoutes.settings),
                  ),
                )
              else
                SliverList.separated(
                  itemCount: items.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: 12),
                  itemBuilder: (context, index) => Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: FeedCard(
                      item: items[index],
                      // Which feed an item is from matters only when the
                      // list mixes feeds.
                      feedNames: selected == null && enabled.length > 1
                          ? [for (final id in items[index].feedIds) ?names[id]]
                          : const [],
                    ),
                  ),
                ),
            ];
          },
        );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.icon,
    required this.title,
    required this.actionLabel,
    required this.onAction,
    this.body,
  });

  final IconData icon;
  final String title;
  final String? body;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 40, color: theme.colorScheme.outline),
          const SizedBox(height: 16),
          Text(
            title,
            style: theme.textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          if (body != null) ...[
            const SizedBox(height: 8),
            Text(
              body!,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 20),
          OutlinedButton(onPressed: onAction, child: Text(actionLabel)),
        ],
      ),
    );
  }
}

/// One feed entry. A community event opens its page; a map item opens on the
/// map, through the same request the chat's card items use.
class FeedCard extends ConsumerWidget {
  const FeedCard({required this.item, this.feedNames = const [], super.key});

  final FeedItem item;

  /// The feeds the item came from, named beside its topic.
  final List<String> feedNames;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final when = item.when;
    final meta = <String>[
      if (when != null) _formatWhen(clock.toMelbourne(when)),
      ?item.place,
      ?item.sourceLabel,
    ];

    void open() {
      final eventId = item.userEventId;
      if (eventId != null) {
        ref.read(eventsPanelRequestsProvider.notifier).openEvent(eventId);
        context.go(AppRoutes.discover);
        return;
      }
      final record = item.mapRecord;
      if (record == null) return;
      ref
          .read(cardItemRequestsProvider.notifier)
          .request(
            CardItem(
              title: item.title,
              source: FeatureCardSource(featureId: record.item.id),
            ),
            mapRecord: record,
          );
      context.go(AppRoutes.discover);
    }

    return Card(
      child: InkWell(
        key: ValueKey('feed-item-${item.id}'),
        onTap: open,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    feedTopicIcon(item.topic),
                    size: 16,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      [
                        feedTopicTitle(strings, item.topic),
                        ...feedNames,
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  if (item.isSample) ...[
                    const Spacer(),
                    Text(
                      strings.sampleBadge,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.outline,
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 8),
              Text(
                item.title,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (item.summary != null) ...[
                const SizedBox(height: 4),
                Text(
                  item.summary!,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              if (meta.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  meta.join(' · '),
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.outline,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

String _formatWhen(DateTime time) =>
    '${DateFormat('EEE d MMM', 'en_AU').format(time)}, '
    '${DateFormat('h:mm a', 'en_AU').format(time)}';
