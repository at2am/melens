import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/network/public_source_opener.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../map/data/map_models.dart';
import '../../map/ui/renderers/core_renderers.dart';
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

String travelModeLabel(AppLocalizations strings, TravelMode mode) =>
    switch (mode) {
      TravelMode.walk => strings.cardTravelWalk,
      TravelMode.transit => strings.cardTravelTransit,
      TravelMode.drive => strings.cardTravelDrive,
      TravelMode.cycle => strings.cardTravelCycle,
    };

IconData travelModeIcon(TravelMode mode) => switch (mode) {
  TravelMode.walk => Icons.directions_walk,
  TravelMode.transit => Icons.directions_transit,
  TravelMode.drive => Icons.directions_car,
  TravelMode.cycle => Icons.directions_bike,
};

String _distance(int metres) => metres >= 1000
    ? '${(metres / 1000).toStringAsFixed(1).replaceAll(RegExp(r'\.0$'), '')} km'
    : '$metres m';

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
    this.itemFooter,
    this.itemLeading,
    this.currentItem,
    super.key,
  });

  final AgentCard card;
  final IconData icon;

  /// Actions under the items, for example a plan's change and save buttons.
  final Widget? footer;

  /// Actions inside one item's tile, for example refreshing a saved plan
  /// stop's parking; null for none.
  final Widget? Function(int index, CardItem item)? itemFooter;

  /// What stands before one item in place of its number, for example a
  /// saved plan stop's visited tick; null keeps the number.
  final Widget? Function(int index, CardItem item)? itemLeading;

  /// The item drawn outlined in the accent colour, for example the stop the
  /// user visits next; null for none.
  final int? currentItem;

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
                if (card.travelMode case final mode?)
                  Row(
                    key: ValueKey('agent-card-travel-${card.id}'),
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        travelModeIcon(mode),
                        size: 16,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        travelModeLabel(strings, mode),
                        style: theme.textTheme.labelSmall,
                      ),
                    ],
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
                leading: itemLeading?.call(index, item),
                current: index == currentItem,
                clock: clock,
                onTap: onItemTap == null ? null : () => onItemTap!(item),
                onOpenSource: onOpenSource,
                // A bay opens on the map like any card item that cites it.
                onBayTap: onItemTap == null
                    ? null
                    : (bay) => onItemTap!(
                        CardItem(
                          title: strings.stopParkingBayTitle,
                          source: FeatureCardSource(featureId: bay.featureId),
                          location: bay.location,
                        ),
                      ),
                footer: itemFooter?.call(index, item),
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
    this.leading,
    this.current = false,
    this.onTap,
    this.onOpenSource,
    this.onBayTap,
    this.footer,
    super.key,
  });

  final CardItem item;
  final int? index;
  final Widget? leading;
  final bool current;
  final MelbourneClock clock;
  final VoidCallback? onTap;
  final ValueChanged<Uri>? onOpenSource;
  final ValueChanged<StopParkingBay>? onBayTap;
  final Widget? footer;

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
    final parking = item.parking;
    final recommended = parking?.recommended ?? false;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(10),
      side: current
          ? BorderSide(color: colors.primary, width: 2.5)
          : recommended
          ? BorderSide(color: colors.primary, width: 1.5)
          : BorderSide(color: colors.outlineVariant),
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
                if (leading != null)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: leading,
                  )
                else if (index case final number?)
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
                      if (parking != null)
                        ParkingCardItemBody(parking: parking, clock: clock)
                      else ...[
                        Text(item.title, style: theme.textTheme.titleSmall),
                        if (item.summary case final summary?)
                          Text(summary, style: theme.textTheme.bodySmall),
                      ],
                      if (when != null)
                        Text(
                          strings.cardItemTime(when),
                          style: theme.textTheme.bodySmall,
                        ),
                      if (item.cost case final cost? when parking == null)
                        Text(
                          strings.cardItemCost(cost),
                          style: theme.textTheme.bodySmall,
                        ),
                      if (item.gettingThere case final gettingThere?
                          when parking == null)
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
                      if (item.stopParking case final stopParking?)
                        StopParkingView(
                          parking: stopParking,
                          clock: clock,
                          onBayTap: onBayTap,
                          onOpenSource: onOpenSource,
                        ),
                      ?footer,
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

/// A parking card bay (UC-15): what the sensor reads, how far it is from the
/// destination, and the area's fee, time limit, hours and payment, each on a
/// labelled line so they can be compared at a glance. The rules are the
/// area's, never this bay's (no crosswalk links a sensor to its sign), and the
/// note under them always says so.
class ParkingCardItemBody extends StatelessWidget {
  const ParkingCardItemBody({
    required this.parking,
    required this.clock,
    super.key,
  });

  final CardParking parking;
  final MelbourneClock clock;

  static ParkingState _mapState(CardParkingState state) => switch (state) {
    CardParkingState.vacant => ParkingState.vacant,
    CardParkingState.occupied => ParkingState.occupied,
    CardParkingState.noData => ParkingState.noData,
  };

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final stateColor = parkingStateColor(_mapState(parking.state), colors);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: colors.onSurfaceVariant,
    );
    final reported = switch (parking.reportedAt) {
      final value? => switch (DateTime.tryParse(value)) {
        final parsed? => DateFormat.Hm(
          'en_AU',
        ).format(clock.toMelbourne(parsed)),
        null => null,
      },
      null => null,
    };
    final rules = [
      (Icons.payments_outlined, strings.cardParkingFee, parking.fee),
      (Icons.timer_outlined, strings.cardParkingTimeLimit, parking.timeLimit),
      (Icons.schedule, strings.cardParkingHours, parking.hours),
      (Icons.credit_card, strings.cardParkingPayment, parking.payment),
    ].where((rule) => rule.$3 != null).toList();
    final known =
        parking.policyScope == CardParkingPolicyScope.area && rules.isNotEmpty;
    return Column(
      key: const ValueKey('parking-card-item'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            _Badge(
              label: switch (parking.state) {
                CardParkingState.vacant => strings.cardParkingVacant,
                CardParkingState.occupied => strings.cardParkingOccupied,
                CardParkingState.noData => strings.cardParkingNoData,
              },
              color: stateColor,
              icon: Icons.local_parking,
            ),
            if (parking.recommended)
              _Badge(
                key: const ValueKey('parking-card-best'),
                label: strings.cardParkingBest,
                color: colors.primary,
                icon: Icons.star_outline,
              ),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.directions_walk, size: 16, color: colors.primary),
            const SizedBox(width: 4),
            Expanded(
              child: Text(switch (parking.destination) {
                final destination? => strings.cardParkingDistanceTo(
                  _distance(parking.distanceMetres),
                  destination,
                  parking.walkMinutes,
                ),
                null => strings.cardParkingDistance(
                  _distance(parking.distanceMetres),
                  parking.walkMinutes,
                ),
              }, style: theme.textTheme.titleSmall),
            ),
          ],
        ),
        const SizedBox(height: 6),
        if (known) ...[
          for (final (icon, label, value) in rules)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(icon, size: 14, color: colors.onSurfaceVariant),
                  const SizedBox(width: 4),
                  SizedBox(
                    width: 72,
                    child: Text(label, style: theme.textTheme.labelMedium),
                  ),
                  Expanded(
                    child: Text(value!, style: theme.textTheme.bodySmall),
                  ),
                ],
              ),
            ),
          Text(strings.cardParkingAreaRules, style: muted),
        ] else
          Text(strings.cardParkingRulesUnknown, style: muted),
        if (parking.zone != null || reported != null)
          Text(
            [
              if (parking.zone case final zone?) strings.cardParkingZone(zone),
              if (reported != null) strings.cardParkingReported(reported),
            ].join(' · '),
            style: muted,
          ),
      ],
    );
  }
}

/// The live parking around a plan stop the user drives to: the nearest free
/// bays (each opens on the map), how many sensors read free and taken, when
/// they were read, and the area's rules with the note that the sign at the
/// bay decides and that a free sensor is not permission to park.
class StopParkingView extends StatelessWidget {
  const StopParkingView({
    required this.parking,
    required this.clock,
    this.onBayTap,
    this.onOpenSource,
    super.key,
  });

  final StopParking parking;
  final MelbourneClock clock;
  final ValueChanged<StopParkingBay>? onBayTap;
  final ValueChanged<Uri>? onOpenSource;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: colors.onSurfaceVariant,
    );
    final checked = switch (DateTime.tryParse(parking.checkedAt)) {
      final parsed? => DateFormat(
        'h:mm a',
        'en_AU',
      ).format(clock.toMelbourne(parsed)),
      null => parking.checkedAt,
    };
    final best = parking.bays.firstOrNull;
    final radius = _distance(parking.radiusMetres);
    final rules = [
      (strings.cardParkingFee, parking.fee),
      (strings.cardParkingTimeLimit, parking.timeLimit),
      (strings.cardParkingHours, parking.hours),
      (strings.cardParkingPayment, parking.payment),
    ].where((rule) => rule.$2 != null).toList();
    final known =
        parking.policyScope == CardParkingPolicyScope.area && rules.isNotEmpty;
    return Container(
      key: const ValueKey('stop-parking'),
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.local_parking, size: 16, color: colors.primary),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  strings.stopParkingTitle,
                  style: theme.textTheme.labelLarge,
                ),
              ),
              Text(
                strings.stopParkingChecked(checked),
                key: const ValueKey('stop-parking-checked'),
                style: theme.textTheme.labelSmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            best == null
                ? strings.stopParkingNone(radius)
                : strings.stopParkingNearest(
                    _distance(best.distanceMetres),
                    best.walkMinutes,
                  ),
            style: theme.textTheme.bodyMedium,
          ),
          Text(
            strings.stopParkingCounts(parking.vacant, parking.occupied, radius),
            style: muted,
          ),
          if (parking.bays.isNotEmpty) ...[
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final (index, bay) in parking.bays.indexed)
                  ActionChip(
                    key: ValueKey('stop-parking-bay-$index'),
                    avatar: Icon(
                      index == 0 ? Icons.star_outline : Icons.local_parking,
                      size: 16,
                    ),
                    label: Text(
                      strings.stopParkingBay(
                        _distance(bay.distanceMetres),
                        bay.walkMinutes,
                      ),
                    ),
                    visualDensity: VisualDensity.compact,
                    onPressed: onBayTap == null ? null : () => onBayTap!(bay),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 4),
          if (known) ...[
            for (final (label, value) in rules)
              Text('$label: $value', style: theme.textTheme.bodySmall),
            Text(strings.cardParkingAreaRules, style: muted),
            if (parking.policyUrl case final url?)
              CardSourceLink(url: url, onOpenSource: onOpenSource),
          ] else
            Text(strings.cardParkingRulesUnknown, style: muted),
          Text(strings.stopParkingSensorNote, style: muted),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({
    required this.label,
    required this.color,
    required this.icon,
    super.key,
  });

  final String label;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 3),
            Text(
              label,
              style: theme.textTheme.labelMedium?.copyWith(color: color),
            ),
          ],
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
