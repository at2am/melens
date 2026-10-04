import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';

/// Supplied result facts only. MapDetails supplies shared time/source provenance.
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
    return Column(
      key: const ValueKey('map-anomaly-details'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _fact(strings, strings.mapDetailSensor, details.sensorId),
        _fact(strings, strings.mapDetailResult, details.resultId),
        _fact(strings, strings.mapDetailObservation, details.observationId),
        Text(
          strings.mapObservedWindow(
            _time(clock, details.window.from),
            _time(clock, details.window.to),
          ),
        ),
        _fact(
          strings,
          strings.mapDetailBaselineDefinition,
          details.baselineDefinitionId,
        ),
        _fact(
          strings,
          strings.mapDetailBaselineValue,
          details.baselineValue?.toString(),
        ),
        _fact(
          strings,
          strings.mapDetailObservedValue,
          details.observedValue?.toString(),
        ),
        _fact(strings, strings.mapDetailDelta, details.delta?.toString()),
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
        Text(strings.mapAnomalyCauseUnestablished),
      ],
    );
  }
}

Widget _fact(AppLocalizations strings, String label, String? value) =>
    Text(strings.mapDetailFact(label, value ?? strings.mapDetailUnknown));

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
