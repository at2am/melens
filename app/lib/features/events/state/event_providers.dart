import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/time/melbourne_time.dart';
import '../data/user_event.dart';
import '../data/user_event_repository.dart';

part 'event_providers.g.dart';

/// The person using this device. Until accounts exist (UC-09 open question)
/// it is a local profile whose name the user edits in Settings; the id
/// becomes the Firebase uid once publishing goes through the agent service.
@Riverpod(keepAlive: true)
class CurrentProfile extends _$CurrentProfile {
  @override
  UserProfile build() =>
      const UserProfile(id: 'local-user', displayName: 'You');

  void rename(String displayName) {
    final name = displayName.trim();
    if (name.isEmpty) return;
    state = state.copyWith(displayName: name);
  }
}

@Riverpod(keepAlive: true)
UserEventRepository userEventRepository(Ref ref) {
  final clock = ref.watch(melbourneClockProvider);
  final env = ref.watch(envProvider);
  return InMemoryUserEventRepository(
    seed: env.usesSampleMapData ? sampleUserEvents(clock.now()) : const [],
    now: () => clock.now().toUtc(),
  );
}

/// Every user event, newest state. Mutations go through the repository and
/// replace the list, so listeners (feed, map, detail) all update.
@Riverpod(keepAlive: true)
class UserEvents extends _$UserEvents {
  @override
  Future<List<UserEvent>> build() =>
      ref.watch(userEventRepositoryProvider).list();

  UserEventRepository get _repository => ref.read(userEventRepositoryProvider);

  Future<UserEvent> publish(UserEventDraft draft) async {
    final event = await _repository.publish(
      draft,
      ref.read(currentProfileProvider),
    );
    state = AsyncData(await _repository.list());
    return event;
  }

  Future<void> setGoing(String eventId, bool going) async {
    await _repository.setGoing(
      eventId,
      ref.read(currentProfileProvider),
      going,
    );
    state = AsyncData(await _repository.list());
  }

  Future<void> cancel(String eventId) async {
    await _repository.cancel(eventId, ref.read(currentProfileProvider));
    state = AsyncData(await _repository.list());
  }
}

/// One event by id, or null when it does not exist.
@riverpod
UserEvent? userEventById(Ref ref, String id) {
  final events = ref.watch(userEventsProvider).value;
  if (events == null) return null;
  for (final event in events) {
    if (event.id == id) return event;
  }
  return null;
}

/// Events that are on the map and in the feed: public, not cancelled, not
/// finished.
@riverpod
List<UserEvent> publicUpcomingEvents(Ref ref) {
  final now = ref.watch(melbourneClockProvider).now().toUtc();
  final events = ref.watch(userEventsProvider).value ?? const <UserEvent>[];
  return events
      .where(
        (event) =>
            event.visibility == EventVisibility.public &&
            !event.cancelled &&
            !event.hasEnded(now),
      )
      .toList()
    ..sort((a, b) => a.startAt.compareTo(b.startAt));
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

/// Whether community events are drawn on the map. They are not a layer of
/// the map contract (v1 registers nine layers), so the app keeps this switch
/// itself and the map shows it beside the contract layers.
@Riverpod(keepAlive: true)
class CommunityLayerEnabled extends _$CommunityLayerEnabled {
  @override
  bool build() => true;

  void set({required bool enabled}) => state = enabled;
}
