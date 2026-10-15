import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/data/user_event_models.dart';
import 'package:melens/features/events/state/user_events_providers.dart';
import 'package:melens/features/map/data/map_models.dart';

import '../fake_user_events_client.dart';

const cbd = MapBounds(west: 144.95, south: -37.82, east: 144.98, north: -37.8);

ProviderContainer makeContainer(
  FakeUserEventsClient client, {
  MapBounds? bounds = cbd,
}) => ProviderContainer.test(
  retry: (retryCount, error) => null,
  overrides: [
    userEventsClientProvider.overrideWithValue(client),
    userEventSearchBoundsProvider.overrideWith((ref) => bounds),
    melbourneClockProvider.overrideWithValue(
      MelbourneClock(now: () => fakeNow),
    ),
  ],
);

void main() {
  test(
    'a wide viewport is cut down to the discover limit around its centre',
    () {
      final clamped = clampSearchBounds(
        const MapBounds(west: 144.5, south: -38.2, east: 145.5, north: -37.4),
      );
      expect(clamped.north - clamped.south, closeTo(0.0853, 0.001));
      expect(clamped.east - clamped.west, closeTo(0.108, 0.001));
      expect((clamped.north + clamped.south) / 2, closeTo(-37.8, 1e-9));
      expect((clamped.east + clamped.west) / 2, closeTo(145.0, 1e-9));
      final small = clampSearchBounds(cbd);
      for (final (actual, expected) in [
        (small.west, cbd.west),
        (small.south, cbd.south),
        (small.east, cbd.east),
        (small.north, cbd.north),
      ]) {
        expect(actual, closeTo(expected, 1e-9));
      }
    },
  );

  test('the nearby list loads the search box for the next two weeks when '
      'activated', () async {
    final client = FakeUserEventsClient([
      fakeEvent('ue_2', startAt: DateTime.utc(2026, 10, 13, 7)),
      fakeEvent('ue_1'),
      fakeEvent('ue_far', point: const AgentLatLng(lat: -38.5, lng: 145.5)),
    ]);
    final container = makeContainer(client);
    final nearby = container.read(nearbyUserEventsControllerProvider.notifier);
    expect(container.read(nearbyUserEventsControllerProvider).hasLoaded, false);
    nearby.setActive(true);
    await pumpEventQueue();
    final state = container.read(nearbyUserEventsControllerProvider);
    expect(state.events.map((e) => e.id), ['ue_1', 'ue_2']);
    expect(state.isLoading, isFalse);
    expect(state.hasLoaded, isTrue);
    expect(client.lastBounds!.toJson(), cbd.toJson());
    expect(client.lastFrom, fakeNow);
    expect(client.lastTo, fakeNow.add(const Duration(days: 14)));
  });

  test(
    'without a viewport the nearby list is empty and no request is made',
    () async {
      final client = FakeUserEventsClient([fakeEvent('ue_1')]);
      final container = makeContainer(client, bounds: null);
      container
          .read(nearbyUserEventsControllerProvider.notifier)
          .setActive(true);
      await pumpEventQueue();
      expect(
        container.read(nearbyUserEventsControllerProvider).events,
        isEmpty,
      );
      expect(client.calls, isEmpty);
    },
  );

  test(
    'a failed load keeps the previous events and reports the error',
    () async {
      final client = FakeUserEventsClient([fakeEvent('ue_1')]);
      final container = makeContainer(client);
      final nearby = container.read(
        nearbyUserEventsControllerProvider.notifier,
      );
      await nearby.refresh();
      expect(
        container.read(nearbyUserEventsControllerProvider).events,
        hasLength(1),
      );
      client.failure = conflict('x');
      await nearby.refresh();
      final state = container.read(nearbyUserEventsControllerProvider);
      expect(state.events, hasLength(1));
      expect(state.error, isNotNull);
      expect(state.isLoading, isFalse);
    },
  );

  test(
    'joining through the details updates the nearby and mine lists',
    () async {
      final client = FakeUserEventsClient([fakeEvent('ue_1', capacity: 5)]);
      final container = makeContainer(client);
      await container
          .read(nearbyUserEventsControllerProvider.notifier)
          .refresh();
      await container.read(myUserEventsControllerProvider.future);
      final detail = container.read(
        userEventDetailControllerProvider('ue_1').notifier,
      );
      final shown = await container.read(
        userEventDetailControllerProvider('ue_1').future,
      );
      expect(shown.viewer.joined, isFalse);
      final joined = await detail.join(displayName: 'Sam');
      expect(joined.viewer.joined, isTrue);
      expect(joined.attendeeCount, 1);
      expect(client.lastDisplayName, 'Sam');
      expect(
        container
            .read(nearbyUserEventsControllerProvider)
            .events
            .single
            .viewer
            .joined,
        isTrue,
      );
      expect(
        container.read(myUserEventsControllerProvider).value!.joined.single.id,
        'ue_1',
      );
      await detail.leave();
      expect(
        container.read(myUserEventsControllerProvider).value!.joined,
        isEmpty,
      );
      expect(
        container
            .read(userEventDetailControllerProvider('ue_1'))
            .value!
            .viewer
            .joined,
        isFalse,
      );
    },
  );

  test('a refused action propagates and leaves the shown event', () async {
    final client = FakeUserEventsClient([fakeEvent('ue_1', joined: true)]);
    final container = makeContainer(client);
    final detail = container.read(
      userEventDetailControllerProvider('ue_1').notifier,
    );
    await container.read(userEventDetailControllerProvider('ue_1').future);
    await expectLater(detail.join(), throwsA(isA<Object>()));
    expect(
      container.read(userEventDetailControllerProvider('ue_1')).value!.id,
      'ue_1',
    );
  });

  test(
    'publishing lists the event in mine and, inside the box, nearby',
    () async {
      final client = FakeUserEventsClient();
      final container = makeContainer(client);
      await container
          .read(nearbyUserEventsControllerProvider.notifier)
          .refresh();
      await container.read(myUserEventsControllerProvider.future);
      final event = await container
          .read(myUserEventsControllerProvider.notifier)
          .publish(
            UserEventDraft(
              title: 'Walk',
              description: '',
              point: const AgentLatLng(lat: -37.81, lng: 144.96),
              startAt: DateTime.utc(2026, 10, 12, 7),
            ),
          );
      expect(event.viewer.isOwner, isTrue);
      expect(
        container.read(myUserEventsControllerProvider).value!.owned.single.id,
        event.id,
      );
      expect(
        container.read(nearbyUserEventsControllerProvider).events.single.id,
        event.id,
      );
      await container
          .read(userEventDetailControllerProvider(event.id).notifier)
          .remove();
      expect(
        container.read(nearbyUserEventsControllerProvider).events,
        isEmpty,
      );
      expect(
        container.read(myUserEventsControllerProvider).value!.owned,
        isEmpty,
      );
    },
  );

  test(
    'removing a member drops it from the page and refreshes the count',
    () async {
      final client = FakeUserEventsClient([
        fakeEvent('ue_1', isOwner: true, attendeeCount: 2),
      ]);
      client.memberLists['ue_1'] = [
        UserEventMember(memberId: 'm_1', displayName: 'Sam', joinedAt: fakeNow),
        UserEventMember(memberId: 'm_2', displayName: null, joinedAt: fakeNow),
      ];
      final container = makeContainer(client);
      await container.read(userEventDetailControllerProvider('ue_1').future);
      final page = await container.read(
        userEventMembersControllerProvider('ue_1').future,
      );
      expect(page.members, hasLength(2));
      await container
          .read(userEventMembersControllerProvider('ue_1').notifier)
          .removeMember('m_1');
      final after = container.read(userEventMembersControllerProvider('ue_1'));
      expect(after.value!.members!.single.memberId, 'm_2');
      expect(after.value!.count, 1);
      expect(client.calls, contains('removeMember ue_1 m_1'));
      expect(
        container
            .read(userEventDetailControllerProvider('ue_1'))
            .value!
            .attendeeCount,
        1,
      );
    },
  );

  test('the display name is remembered for the session', () {
    final container = makeContainer(FakeUserEventsClient());
    container.read(userEventDisplayNameProvider.notifier).remember('  Sam ');
    expect(container.read(userEventDisplayNameProvider), 'Sam');
    container.read(userEventDisplayNameProvider.notifier).remember('  ');
    expect(container.read(userEventDisplayNameProvider), isNull);
  });
}
