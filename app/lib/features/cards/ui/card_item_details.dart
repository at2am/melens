import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/network/public_source_opener.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import 'agent_card_view.dart';

/// The details pane for a tapped card item that is not a map record, such as
/// a Google Maps place or a web source: what the agent reported about it and
/// where it came from. Map records open [MapDetails] instead.
class CardItemDetails extends ConsumerWidget {
  const CardItemDetails({
    required this.item,
    required this.onClose,
    this.onOpenSource,
    super.key,
  });

  final CardItem item;
  final VoidCallback onClose;
  final ValueChanged<Uri>? onOpenSource;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final clock = ref.watch(melbourneClockProvider);
    final time = item.time;
    final when = time == null
        ? null
        : formatCardTimeWindow(strings, clock, time);
    final source = item.source;
    final uri = source is LinkCardSource ? Uri.tryParse(source.url) : null;
    final canOpen =
        onOpenSource != null && uri != null && isPublicSourceUri(uri);
    return CallbackShortcuts(
      bindings: {const SingleActivator(LogicalKeyboardKey.escape): onClose},
      child: Focus(
        autofocus: true,
        child: Semantics(
          container: true,
          label: strings.cardItemDetailsTitle,
          child: Material(
            key: const ValueKey('card-item-details'),
            color: colors.surface,
            shape: RoundedRectangleBorder(
              side: BorderSide(color: colors.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          strings.cardItemDetailsTitle,
                          style: theme.textTheme.titleMedium,
                        ),
                      ),
                      IconButton(
                        key: const ValueKey('card-item-details-close'),
                        tooltip: strings.cardItemDetailsClose,
                        onPressed: onClose,
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.title, style: theme.textTheme.titleLarge),
                        if (item.summary case final summary?) ...[
                          const SizedBox(height: 8),
                          Text(summary, style: theme.textTheme.bodyMedium),
                        ],
                        const SizedBox(height: 12),
                        if (when != null && when.isNotEmpty)
                          Text(strings.cardItemTime(when)),
                        if (item.cost case final cost?)
                          Text(strings.cardItemCost(cost)),
                        if (item.gettingThere case final gettingThere?)
                          Text(strings.cardItemGettingThere(gettingThere)),
                        const SizedBox(height: 12),
                        Text(
                          strings.cardItemDetailsNotOnMap,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 8),
                        switch (source) {
                          FeatureCardSource(:final featureId) => Text(
                            strings.cardSourceFeature(featureId),
                            style: theme.textTheme.labelSmall,
                          ),
                          LinkCardSource(:final url, :final title) =>
                            CardSourceLink(
                              url: url,
                              title: title,
                              onOpenSource: onOpenSource,
                            ),
                        },
                        if (canOpen) ...[
                          const SizedBox(height: 8),
                          FilledButton.tonalIcon(
                            key: const ValueKey('card-item-details-open'),
                            onPressed: () => onOpenSource!(uri),
                            icon: const Icon(Icons.open_in_new),
                            label: Text(strings.cardItemDetailsOpenSource),
                          ),
                        ],
                        if (item.placeId != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            strings.cardGoogleMapsAttribution,
                            style: theme.textTheme.labelSmall,
                          ),
                        ],
                      ],
                    ),
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
