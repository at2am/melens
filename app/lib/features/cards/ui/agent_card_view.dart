import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/network/public_source_opener.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import 'card_registry.dart';

/// A card item's time window in Melbourne local time, or an empty string
/// when both ends are missing.
String formatCardTimeWindow(
  AppLocalizations strings,
  MelbourneClock clock,
  AgentTimeWindow time,
) {
  String? local(String? value) {
    if (value == null) return null;
    final parsed = DateTime.tryParse(value);
    if (parsed == null) return value;
    final melbourne = clock.toMelbourne(parsed);
    return '${DateFormat.MMMEd('en_AU').format(melbourne)} '
        '${DateFormat.Hm('en_AU').format(melbourne)}';
  }

  final from = local(time.from);
  final to = local(time.to);
  if (from != null && to != null) return strings.cardTimeRange(from, to);
  if (from != null) return strings.cardTimeFrom(from);
  if (to != null) return strings.cardTimeUntil(to);
  return '';
}

String cardTypeLabel(AppLocalizations strings, CardType type) => switch (type) {
  CardType.areaBrief => strings.cardTypeAreaBrief,
  CardType.anomalyAnalysis => strings.cardTypeAnomalyAnalysis,
  CardType.plan => strings.cardTypePlan,
  CardType.history => strings.cardTypeHistory,
  CardType.list => strings.cardTypeList,
};

/// A result card: title, intro, items with their sources, and the provider
/// attribution. Each item is a tile of its own, so where one ends and the
/// next begins is always clear. Every item cites a feature id or a link the
/// server verified (agent-design.md, Source rules), so the source is always
/// shown.
class AgentCardView extends ConsumerWidget {
  const AgentCardView({
    required this.card,
    required this.icon,
    this.numbered = false,
    this.onItemTap,
    this.onOpenSource,
    this.footer,
    super.key,
  });

  final AgentCard card;
  final IconData icon;

  /// Actions under the items, for example a plan's change and save buttons.
  final Widget? footer;

  /// Plans list stops in visiting order.
  final bool numbered;
  final CardItemCallback? onItemTap;
  final ValueChanged<Uri>? onOpenSource;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final clock = ref.watch(melbourneClockProvider);
    return Card(
      key: ValueKey('agent-card-${card.id}'),
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    cardTypeLabel(strings, card.type),
                    style: theme.textTheme.labelSmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(card.title, style: theme.textTheme.titleMedium),
            if (card.intro case final intro?) ...[
              const SizedBox(height: 4),
              Text(intro, style: theme.textTheme.bodyMedium),
            ],
            const SizedBox(height: 8),
            for (final (index, item) in card.items.indexed)
              _CardItemView(
                key: ValueKey('agent-card-item-${card.id}-$index'),
                item: item,
                index: numbered ? index + 1 : null,
                clock: clock,
                onTap: onItemTap == null ? null : () => onItemTap!(item),
                onOpenSource: onOpenSource,
              ),
            if (card.hasGoogleMapsAttribution) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  Icon(
                    Icons.map_outlined,
                    size: 14,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      strings.cardGoogleMapsAttribution,
                      style: theme.textTheme.labelSmall,
                    ),
                  ),
                ],
              ),
            ],
            ?footer,
          ],
        ),
      ),
    );
  }
}

/// One item as an outlined tile on the card's surface; tappable items show a
/// chevron.
class _CardItemView extends StatelessWidget {
  const _CardItemView({
    required this.item,
    required this.index,
    required this.clock,
    this.onTap,
    this.onOpenSource,
    super.key,
  });

  final CardItem item;
  final int? index;
  final MelbourneClock clock;
  final VoidCallback? onTap;
  final ValueChanged<Uri>? onOpenSource;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final source = item.source;
    final time = item.time;
    final when = time == null
        ? null
        : formatCardTimeWindow(strings, clock, time);
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(10),
      side: BorderSide(color: colors.outlineVariant),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Material(
        color: colors.surface,
        shape: shape,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          customBorder: shape,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (index case final number?)
                  Padding(
                    padding: const EdgeInsets.only(right: 8, top: 2),
                    child: CircleAvatar(
                      radius: 11,
                      child: Text('$number', style: theme.textTheme.labelSmall),
                    ),
                  ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.title, style: theme.textTheme.titleSmall),
                      if (item.summary case final summary?)
                        Text(summary, style: theme.textTheme.bodySmall),
                      if (when != null)
                        Text(
                          strings.cardItemTime(when),
                          style: theme.textTheme.bodySmall,
                        ),
                      if (item.cost case final cost?)
                        Text(
                          strings.cardItemCost(cost),
                          style: theme.textTheme.bodySmall,
                        ),
                      if (item.gettingThere case final gettingThere?)
                        Text(
                          strings.cardItemGettingThere(gettingThere),
                          style: theme.textTheme.bodySmall,
                        ),
                      switch (source) {
                        FeatureCardSource(:final featureId) => Row(
                          children: [
                            Icon(
                              Icons.place_outlined,
                              size: 14,
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                strings.cardSourceFeature(featureId),
                                style: theme.textTheme.labelSmall,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                        LinkCardSource(:final url, :final title) =>
                          CardSourceLink(
                            url: url,
                            title: title,
                            onOpenSource: onOpenSource,
                          ),
                      },
                    ],
                  ),
                ),
                if (onTap != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 4, top: 2),
                    child: Icon(
                      Icons.chevron_right,
                      size: 18,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A card item's web source: its title or host, opened through
/// [onOpenSource] when the URL is a public one the app may open.
class CardSourceLink extends StatelessWidget {
  const CardSourceLink({
    required this.url,
    this.title,
    this.onOpenSource,
    super.key,
  });

  final String url;
  final String? title;
  final ValueChanged<Uri>? onOpenSource;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final uri = Uri.tryParse(url);
    final label = title ?? uri?.host ?? url;
    final canOpen =
        onOpenSource != null && uri != null && isPublicSourceUri(uri);
    return Row(
      children: [
        Icon(Icons.link, size: 14, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 4),
        Flexible(
          child: canOpen
              ? InkWell(
                  onTap: () => onOpenSource!(uri),
                  child: Text(
                    strings.cardSourceLink(label),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.primary,
                      decoration: TextDecoration.underline,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                )
              : Text(
                  strings.cardSourceLink(label),
                  style: theme.textTheme.labelSmall,
                  overflow: TextOverflow.ellipsis,
                ),
        ),
      ],
    );
  }
}
