import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import '../data/source_summaries.dart';
import 'map_detail_parts.dart';

/// Supplied result facts only. MapDetails supplies shared time/source
/// provenance and the result, observation and baseline ids.
class AnomalyDetailsSection extends ConsumerWidget {
  const AnomalyDetailsSection({required this.item, super.key});

  final AnomalyMapItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    if (item.lifecycle == MapLifecycle.withdrawn) {
      return Text(strings.mapDetailsWithdrawn);
    }
    final clock = ref.watch(melbourneClockProvider);
    final details = item.details;
    final colors = Theme.of(context).colorScheme;
    final change = _change(strings, details);
    final baselineDays = sameHourBaselineDays(details.baselineDefinitionId);
    String exact(num? value) =>
        value == null ? strings.mapDetailUnknown : formatExactNumber(value);
    return Column(
      key: const ValueKey('map-anomaly-details'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (change != null)
          MapDetailHeadline(
            value: change,
            color: switch (details.direction) {
              AnomalyDirection.lower => colors.error,
              AnomalyDirection.higher => colors.primary,
              _ => null,
            },
          ),
        MapDetailFactRow(
          label: strings.mapDetailTime,
          value: strings.mapDetailRange(
            _time(clock, details.window.from),
            _time(clock, details.window.to),
          ),
        ),
        MapDetailFactRow(
          label: strings.mapDetailObservedValue,
          value: exact(details.observedValue),
        ),
        MapDetailFactRow(
          label: strings.mapDetailUsual,
          value: exact(details.baselineValue),
          caption: baselineDays == null
              ? null
              : strings.mapAnomalyBaselineSameHour(baselineDays.toString()),
        ),
        MapDetailFactRow(
          label: strings.mapDetailDelta,
          value: exact(details.delta),
        ),
        if (details.eligibility == AnomalyEligibility.ineligible)
          MapDetailNote(strings.mapAnomalyIneligibleNote),
        if (details.eligibility == AnomalyEligibility.unknown)
          MapDetailNote(strings.mapAnomalyEligibilityUnknownNote),
        MapDetailNote(strings.mapAnomalyCauseUnestablished),
      ],
    );
  }
}

/// Classification as a short chip for the panel header.
MapStatusChip anomalyClassificationChip(
  AppLocalizations strings,
  AnomalyClassification classification,
) => switch (classification) {
  AnomalyClassification.anomalous => MapStatusChip(
    label: strings.mapAnomalyUnusual,
    tone: MapChipTone.caution,
  ),
  AnomalyClassification.notAnomalous => MapStatusChip(
    label: strings.mapAnomalyNormal,
  ),
  AnomalyClassification.unclassified => MapStatusChip(
    label: strings.mapAnomalyNotChecked,
  ),
};

/// Producer ids and the raw direction, eligibility and classification, for
/// the technical section.
List<Widget> anomalyTechnicalFacts(
  AppLocalizations strings,
  AnomalyDetails details,
) {
  Widget fact(String label, String? value) =>
      Text(strings.mapDetailFact(label, value ?? strings.mapDetailUnknown));
  return [
    fact(strings.mapDetailSensor, details.sensorId),
    fact(strings.mapDetailResult, details.resultId),
    fact(strings.mapDetailObservation, details.observationId),
    fact(strings.mapDetailBaselineDefinition, details.baselineDefinitionId),
    Text(switch (details.direction) {
      AnomalyDirection.higher => strings.mapAnomalyDirectionHigher,
      AnomalyDirection.lower => strings.mapAnomalyDirectionLower,
      AnomalyDirection.none => strings.mapAnomalyDirectionNone,
      AnomalyDirection.unknown => strings.mapAnomalyDirectionUnknown,
    }),
    Text(switch (details.eligibility) {
      AnomalyEligibility.eligible => strings.mapAnomalyEligible,
      AnomalyEligibility.ineligible => strings.mapAnomalyIneligible,
      AnomalyEligibility.unknown => strings.mapAnomalyEligibilityUnknown,
    }),
    Text(switch (details.classification) {
      AnomalyClassification.anomalous => strings.mapAnomalyClassified,
      AnomalyClassification.notAnomalous => strings.mapAnomalyNotAnomalous,
      AnomalyClassification.unclassified => strings.mapAnomalyUnclassified,
    }),
  ];
}

/// "89% below usual", from the supplied observation and baseline. Null when
/// either is missing, the baseline is zero or the producer gave no direction.
String? _change(AppLocalizations strings, AnomalyDetails details) {
  final observed = details.observedValue;
  final baseline = details.baselineValue;
  if (details.direction == AnomalyDirection.none) {
    return strings.mapAnomalyInLine;
  }
  if (observed == null || baseline == null || baseline <= 0) return null;
  final percent = NumberFormat.percentPattern('en_AU')
      .format((observed - baseline).abs() / baseline);
  return switch (details.direction) {
    AnomalyDirection.lower => strings.mapAnomalyBelow(percent),
    AnomalyDirection.higher => strings.mapAnomalyAbove(percent),
    _ => null,
  };
}

String _time(MelbourneClock clock, DateTime value) {
  final local = clock.toMelbourne(value);
  final fraction = (local.millisecond * 1000 + local.microsecond)
      .toString()
      .padLeft(6, '0')
      .replaceFirst(RegExp(r'0+$'), '');
  return '${DateFormat.yMMMd('en_AU').format(local)}, '
      '${DateFormat.Hms('en_AU').format(local)}'
      '${fraction.isEmpty ? '' : '.$fraction'} ${local.timeZoneName}';
}
