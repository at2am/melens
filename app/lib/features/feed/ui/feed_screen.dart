import 'dart:async';

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
import 'feed_topic_list.dart';

/// The home tab: what is happening in the topics the user follows. Topics are
/// chips under the title; the feed refreshes by pulling down.
class FeedScreen extends ConsumerWidget {
  const FeedScreen({super.key});

  /// The feed and the sources it reads: they do not retry on their own, so
  /// a source that failed once keeps its error until it is invalidated too.
  static void _refresh(WidgetRef ref) {
    ref
      ..invalidate(communityEventsProvider)
      ..invalidate(mapFeedItemsProvider)
      ..invalidate(feedProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final subscribed = ref.watch(feedSubscriptionsProvider);
    final feed = ref.watch(feedProvider);
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
                      icon: const Icon(Icons.add),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: SizedBox(
                height: 64,
                child: ListView(
                  key: const ValueKey('feed-topic-chips'),
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 12,
                  ),
                  children: [
                    for (final topic in FeedTopic.values) ...[
                      FilterChip(
                        key: ValueKey('feed-chip-${topic.name}'),
                        avatar: Icon(feedTopicIcon(topic), size: 18),
                        label: Text(feedTopicTitle(strings, topic)),
                        selected: subscribed.contains(topic),
                        onSelected: (_) => ref
                            .read(feedSubscriptionsProvider.notifier)
                            .toggle(topic),
                      ),
                      const SizedBox(width: 8),
                    ],
                  ],
                ),
              ),
            ),
            ..._body(context, ref, feed, subscribed),
            const SliverToBoxAdapter(child: SizedBox(height: 96)),
          ],
        ),
      ),
    );
  }

  List<Widget> _body(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<FeedResult> feed,
    Set<FeedTopic> subscribed,
  ) {
    final strings = AppLocalizations.of(context);
    if (subscribed.isEmpty) {
      return [
        SliverFillRemaining(
          hasScrollBody: false,
          child: _Message(
            icon: Icons.tune,
            title: strings.feedEmptyNoTopics,
            body: strings.feedEmptyNoTopicsBody,
            actionLabel: strings.feedChooseTopics,
            onAction: () => _showTopics(context),
          ),
        ),
      ];
    }
    // A source arriving rebuilds the feed; it keeps showing what it has.
    return feed.when(
      skipLoadingOnReload: true,
      loading: () => [
        const SliverFillRemaining(
          hasScrollBody: false,
          child: Center(child: CircularProgressIndicator()),
        ),
      ],
      error: (error, stack) => [
        SliverFillRemaining(
          hasScrollBody: false,
          child: _Message(
            icon: Icons.cloud_off,
            title: strings.feedError,
            actionLabel: strings.feedRetry,
            onAction: () => _refresh(ref),
          ),
        ),
      ],
      data: (result) {
        final failed = result.failedTopics;
        final loading = result.loadingTopics.isNotEmpty;
        return [
          if (loading && result.items.isNotEmpty)
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
                  strings.feedSourceFailed(
                    failed.map((t) => feedTopicTitle(strings, t)).join(', '),
                  ),
                  key: const ValueKey('feed-source-failed'),
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          if (result.items.isEmpty && loading)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: Center(child: CircularProgressIndicator()),
            )
          else if (result.items.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _Message(
                icon: Icons.nightlight_outlined,
                title: strings.feedEmpty,
                body: strings.feedEmptyBody,
                actionLabel: strings.feedChooseTopics,
                onAction: () => _showTopics(context),
              ),
            )
          else
            SliverList.separated(
              itemCount: result.items.length,
              separatorBuilder: (context, index) => const SizedBox(height: 12),
              itemBuilder: (context, index) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: FeedCard(item: result.items[index]),
              ),
            ),
        ];
      },
    );
  }

  void _showTopics(BuildContext context) {
    final strings = AppLocalizations.of(context);
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (context) => SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  strings.feedTopicsSheetTitle,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 4),
                Text(strings.feedTopicsSheetBody),
                const SizedBox(height: 8),
                const FeedTopicList(),
              ],
            ),
          ),
        ),
      ),
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
  const FeedCard({required this.item, super.key});

  final FeedItem item;

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
      final featureId = item.mapFeatureId;
      if (featureId == null) return;
      ref
          .read(cardItemRequestsProvider.notifier)
          .request(
            CardItem(
              title: item.title,
              source: FeatureCardSource(featureId: featureId),
            ),
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
                  Text(
                    feedTopicTitle(strings, item.topic),
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: theme.colorScheme.primary,
                      fontWeight: FontWeight.w700,
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
