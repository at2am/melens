import 'package:flutter_riverpod/misc.dart' show ProviderException;
import 'package:intl/intl.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../data/user_event_models.dart';

/// Melbourne local time, for example `Mon 12 Oct, 6:00 PM`.
String formatEventTime(MelbourneClock clock, DateTime instant) =>
    DateFormat('EEE d MMM, h:mm a').format(clock.toMelbourne(instant));

String _formatClock(tz.TZDateTime time) => DateFormat('h:mm a').format(time);

/// The event's start, with its end when it has one: the end's time alone on
/// the same day, its date otherwise.
String formatEventWhen(
  AppLocalizations strings,
  MelbourneClock clock,
  UserEvent event,
) {
  final start = clock.toMelbourne(event.startAt);
  final end = event.endAt;
  if (end == null) return formatEventTime(clock, event.startAt);
  final endLocal = clock.toMelbourne(end);
  final sameDay =
      start.year == endLocal.year &&
      start.month == endLocal.month &&
      start.day == endLocal.day;
  return strings.eventsTimeRange(
    formatEventTime(clock, event.startAt),
    sameDay ? _formatClock(endLocal) : formatEventTime(clock, end),
  );
}

/// How many are going, against the capacity when there is one.
String formatEventGoing(AppLocalizations strings, UserEvent event) =>
    event.capacity == null
    ? strings.eventsGoing(event.attendeeCount)
    : strings.eventsGoingOf(event.attendeeCount, event.capacity!);

String formatEventPin(AppLocalizations strings, AgentLatLng point) => strings
    .eventsPlacePin(point.lat.toStringAsFixed(5), point.lng.toStringAsFixed(5));

/// What the user reads for a failed events request (agent-protocol.md, User
/// events, Rules 3 for the conflict reasons).
String userEventErrorText(AppLocalizations strings, Object error) =>
    switch (error) {
      // A provider that failed in its build reports the cause wrapped.
      ProviderException(:final exception) => userEventErrorText(
        strings,
        exception,
      ),
      AgentSignInException() ||
      AgentSignInFailedException() => strings.eventsErrorSignIn,
      AgentNetworkException() => strings.eventsErrorNetwork,
      AgentTimeoutException() => strings.eventsErrorTimeout,
      AgentHttpException(:final code, :final reason) => switch (code) {
        AgentErrorCode.conflict => switch (reason) {
          'eventFull' => strings.eventsErrorEventFull,
          'alreadyJoined' => strings.eventsErrorAlreadyJoined,
          'eventCancelled' => strings.eventsErrorEventCancelled,
          'eventEnded' => strings.eventsErrorEventEnded,
          'ownEvent' => strings.eventsErrorOwnEvent,
          'notJoined' => strings.eventsErrorNotJoined,
          _ => strings.eventsErrorUnknown,
        },
        AgentErrorCode.forbidden => strings.eventsErrorForbidden,
        AgentErrorCode.notFound => strings.eventsErrorNotFound,
        AgentErrorCode.rateLimited => strings.eventsErrorRateLimited,
        AgentErrorCode.invalidRequest => strings.eventsErrorInvalid,
        AgentErrorCode.unauthorized => strings.eventsErrorSignIn,
        AgentErrorCode.serviceUnavailable => strings.eventsErrorNetwork,
        AgentErrorCode.timeout => strings.eventsErrorTimeout,
        AgentErrorCode.turnInProgress || null => strings.eventsErrorUnknown,
      },
      _ => strings.eventsErrorUnknown,
    };
