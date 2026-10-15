import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/time/melbourne_time.dart';
import '../../map/data/map_models.dart';
import '../data/user_event_models.dart';
import 'user_events_providers.dart';

part 'event_view_providers.g.dart';

/// Whether user events are drawn on the map. They are not a layer of the map
/// contract (v1 registers nine layers), so the app keeps this switch itself
/// and the map shows it beside the contract layers.
@Riverpod(keepAlive: true)
class CommunityLayerEnabled extends _$CommunityLayerEnabled {
  @override
  bool build() => true;

  void set({required bool enabled}) => state = enabled;
}

/// A request from another tab for the events panel on the map: open one
/// event, or start the form for a new one. The panel belongs to the map
/// screen; the shell parks the request here, switches to the map and the map
/// takes it.
final class EventsPanelRequest {
  const EventsPanelRequest({
    required this.sequence,
    this.eventId,
    this.newEvent = false,
  });

  final int sequence;
  final String? eventId;
  final bool newEvent;
}

@Riverpod(keepAlive: true)
class EventsPanelRequests extends _$EventsPanelRequests {
  int _sequence = 0;

  @override
  EventsPanelRequest? build() => null;

  void openEvent(String eventId) =>
      state = EventsPanelRequest(sequence: ++_sequence, eventId: eventId);

  void startNewEvent() =>
      state = EventsPanelRequest(sequence: ++_sequence, newEvent: true);

  /// The map has taken the request.
  void consume(int sequence) {
    if (state?.sequence == sequence) state = null;
  }
}

/// The origin that invite links point to: the Web app's own origin. Native
/// builds have no public origin yet, so they invite with text only.
@Riverpod(keepAlive: true)
Uri? inviteOrigin(Ref ref) {
  final base = Uri.base;
  return base.scheme.startsWith('http') && base.host.isNotEmpty
      ? Uri(
          scheme: base.scheme,
          host: base.host,
          port: base.hasPort ? base.port : null,
        )
      : null;
}

/// Where the feed looks for community events: a box around central
/// Melbourne, cut to the discover route's size limit. The feed has no map
/// viewport of its own.
final _feedBounds = clampSearchBounds(
  const MapBounds(
    west: 144.8631,
    south: -37.9136,
    east: 145.0631,
    north: -37.7136,
  ),
);

/// The published, upcoming community events near the city centre, for the
/// feed. A failure is the feed's to report; it is not retried here.
@Riverpod(retry: _manualRetry)
Future<List<UserEvent>> communityEvents(Ref ref) async {
  final now = ref.watch(melbourneClockProvider).now().toUtc();
  final events = await ref
      .watch(userEventsClientProvider)
      .discover(_feedBounds, from: now, to: now.add(nearbyUserEventsHorizon));
  return [
    for (final event in events)
      if (!event.isCancelled && !event.hasEndedAt(now)) event,
  ];
}

Duration? _manualRetry(int retryCount, Object error) => null;
