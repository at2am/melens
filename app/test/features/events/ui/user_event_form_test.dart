import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/data/place_search.dart';
import 'package:melens/features/events/data/user_event_models.dart';
import 'package:melens/features/events/state/user_events_providers.dart';
import 'package:melens/features/events/ui/user_event_form.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../fake_place_search.dart';
import '../fake_user_events_client.dart';

Future<ProviderContainer> showForm(
  WidgetTester tester,
  FakeUserEventsClient client, {
  UserEvent? initial,
  List<UserEvent>? saved,
  VoidCallback? onCancel,
  VoidCallback? onPickOnMap,
  // Riverpod does not export its override type; the cast infers it below.
  List<Object> extraOverrides = const [],
  void Function(ProviderContainer container)? prepare,
}) async {
  // A tall screen shows the whole form, so no field or button needs a scroll.
  tester.view.physicalSize = const Size(600, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final container = ProviderContainer(
    // No automatic retry: a failed load stays failed, with no pending timer.
    retry: (retryCount, error) => null,
    overrides: [
      userEventsClientProvider.overrideWithValue(client),
      userEventSearchBoundsProvider.overrideWith((ref) => null),
      melbourneClockProvider.overrideWithValue(
        MelbourneClock(now: () => fakeNow),
      ),
      ...extraOverrides.cast(),
    ],
  );
  addTearDown(container.dispose);
  prepare?.call(container);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: Scaffold(
          body: SizedBox(
            width: 400,
            child: UserEventForm(
              initial: initial,
              initialPoint: const AgentLatLng(lat: -37.8136, lng: 144.9631),
              onSaved: (event) => saved?.add(event),
              onCancel: onCancel ?? () {},
              onPickOnMap: onPickOnMap,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  return container;
}

Future<void> tapVisible(WidgetTester tester, Key key) async {
  final finder = find.byKey(key);
  await tester.ensureVisible(finder);
  // The scroll's ballistic activity ignores pointers until it has ticked.
  await tester.pump();
  await tester.pump();
  await tester.tap(finder);
}

Future<void> enterVisible(WidgetTester tester, Key key, String text) async {
  final finder = find.byKey(key);
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.enterText(finder, text);
}

void main() {
  testWidgets('an empty title is refused before any request', (tester) async {
    final client = FakeUserEventsClient();
    await showForm(tester, client);
    expect(find.text('Publish an event'), findsOneWidget);
    expect(find.byKey(const ValueKey('event-form-start')), findsOneWidget);
    // The next full hour after 07:40 UTC is 19:00 Melbourne.
    expect(find.text('Sat 10 Oct, 7:00 PM'), findsOneWidget);
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    expect(find.text('Give the event a title.'), findsOneWidget);
    expect(client.calls, isEmpty);
  });

  testWidgets('a capacity outside its range is refused', (tester) async {
    final client = FakeUserEventsClient();
    await showForm(tester, client);
    await enterVisible(tester, const ValueKey('event-form-title'), 'Walk');
    await enterVisible(tester, const ValueKey('event-form-capacity'), '1');
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    expect(find.text('Capacity is 2 to 1000.'), findsOneWidget);
    expect(client.calls, isEmpty);
  });

  testWidgets('a valid form publishes the draft with the pin and switches', (
    tester,
  ) async {
    final client = FakeUserEventsClient();
    final saved = <UserEvent>[];
    await showForm(tester, client, saved: saved);
    await enterVisible(
      tester,
      const ValueKey('event-form-title'),
      '  Sunset run  ',
    );
    await enterVisible(
      tester,
      const ValueKey('event-form-description'),
      'Easy 5 km.',
    );
    await enterVisible(
      tester,
      const ValueKey('event-form-place'),
      'Boathouse steps',
    );
    await enterVisible(tester, const ValueKey('event-form-capacity'), '20');
    await tapVisible(tester, const ValueKey('event-form-anonymous'));
    await tester.pump();
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    await tester.pump();
    expect(client.calls, contains('publish'));
    final draft = client.lastDraft!;
    expect(draft.title, 'Sunset run');
    expect(draft.description, 'Easy 5 km.');
    expect(draft.placeName, 'Boathouse steps');
    expect(draft.capacity, 20);
    expect(draft.anonymousAttendance, isTrue);
    expect(draft.point.lat, -37.8136);
    expect(draft.endAt, isNull);
    // 19:00 Melbourne on 10 Oct 2026 (AEDT, +11) is 08:00 UTC.
    expect(draft.startAt, DateTime.utc(2026, 10, 10, 8));
    expect(saved.single.title, 'Sunset run');
  });

  testWidgets('a refusal by the service is shown under the form', (
    tester,
  ) async {
    final client = FakeUserEventsClient()
      ..failOn = 'publish'
      ..failure = const AgentHttpException(
        statusCode: 429,
        retryable: true,
        code: AgentErrorCode.rateLimited,
      );
    await showForm(tester, client);
    await enterVisible(tester, const ValueKey('event-form-title'), 'Walk');
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    await tester.pump();
    expect(
      find.text('Too many changes in an hour. Try again later.'),
      findsOneWidget,
    );
  });

  testWidgets('editing sends only the changed fields, and nothing when '
      'nothing changed', (tester) async {
    final event = fakeEvent('ue_1', isOwner: true, capacity: 20);
    final client = FakeUserEventsClient([event]);
    final saved = <UserEvent>[];
    await showForm(tester, client, initial: event, saved: saved);
    expect(find.text('Edit event'), findsOneWidget);
    expect(find.text('Sunset run along the Yarra'), findsOneWidget);
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Nothing changed.'), findsOneWidget);
    expect(client.calls, isNot(contains('update ue_1')));
    await enterVisible(
      tester,
      const ValueKey('event-form-title'),
      'Sunset run',
    );
    await enterVisible(tester, const ValueKey('event-form-capacity'), '');
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    await tester.pump();
    expect(client.calls, contains('update ue_1'));
    expect(client.lastPatch, {'title': 'Sunset run', 'capacity': null});
    expect(saved.single.version, 2);
  });

  testWidgets('picking on the map keeps the draft, closes the host and takes '
      'the tap', (tester) async {
    final client = FakeUserEventsClient();
    var hostClosed = 0;
    final container = await showForm(
      tester,
      client,
      onPickOnMap: () => hostClosed++,
    );
    await enterVisible(tester, const ValueKey('event-form-title'), 'Walk');
    await tapVisible(tester, const ValueKey('event-form-pick-on-map'));
    await tester.pump();
    expect(hostClosed, 1);
    expect(container.read(userEventPinPickerProvider).active, isTrue);
    expect(container.read(userEventFormDraftProvider)?.title, 'Walk');
    container
        .read(userEventPinPickerProvider.notifier)
        .place(const AgentLatLng(lat: -37.82, lng: 144.97));
    await tester.pump();
    expect(
      container.read(userEventPinPickerProvider).picked,
      isNull,
      reason: 'the open form takes the point at once',
    );
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    await tester.pump();
    expect(client.lastDraft!.point.lat, -37.82);
    expect(client.lastDraft!.point.lng, 144.97);
  });

  testWidgets('a form reopened after picking restores its fields and the '
      'picked pin', (tester) async {
    final client = FakeUserEventsClient();
    final container = await showForm(
      tester,
      client,
      prepare: (container) {
        container
            .read(userEventFormDraftProvider.notifier)
            .keep(
              UserEventFormSnapshot(
                editing: null,
                title: 'Kept walk',
                description: 'Slow',
                placeName: 'Steps',
                start: DateTime.utc(2026, 10, 12, 7),
                end: null,
                anonymous: true,
                capacity: '12',
                point: const AgentLatLng(lat: -37.8136, lng: 144.9631),
              ),
            );
        container
            .read(userEventPinPickerProvider.notifier)
            .place(const AgentLatLng(lat: -37.83, lng: 144.98));
      },
    );
    expect(find.text('Kept walk'), findsOneWidget);
    expect(find.text('Steps'), findsOneWidget);
    await tester.pump();
    expect(container.read(userEventFormDraftProvider), isNull);
    expect(container.read(userEventPinPickerProvider).picked, isNull);
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    await tester.pump();
    final draft = client.lastDraft!;
    expect(draft.title, 'Kept walk');
    expect(draft.anonymousAttendance, isTrue);
    expect(draft.capacity, 12);
    expect(draft.point.lat, -37.83);
    expect(draft.point.lng, 144.98);
  });

  testWidgets('the selected map record becomes the pin and the place name', (
    tester,
  ) async {
    final client = FakeUserEventsClient();
    final record = _pointRecord();
    await showForm(
      tester,
      client,
      extraOverrides: [
        selectionControllerProvider.overrideWith(() => _SelectedRecord(record)),
      ],
    );
    await enterVisible(tester, const ValueKey('event-form-title'), 'Walk');
    await tapVisible(tester, const ValueKey('event-form-use-selected'));
    await tester.pump();
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    await tester.pump();
    final draft = client.lastDraft!;
    expect(draft.placeName, 'Sample sensor A');
    expect(draft.point.lat, -37.818);
    expect(draft.point.lng, 144.967);
  });

  testWidgets('address search offers suggestions and pins the chosen place', (
    tester,
  ) async {
    final client = FakeUserEventsClient();
    final search = FakePlaceSearch(
      suggestions: const [
        PlaceSuggestion(
          placeId: 'p1',
          mainText: 'Federation Square',
          secondaryText: 'Swanston St, Melbourne VIC',
        ),
        PlaceSuggestion(
          placeId: 'p2',
          mainText: 'Federation Wharf',
          secondaryText: 'Melbourne VIC',
        ),
      ],
      locations: const {
        'p1': PlaceLocation(
          point: AgentLatLng(lat: -37.818, lng: 144.9691),
          name: 'Federation Square',
          address: 'Swanston St & Flinders St, Melbourne VIC 3000',
        ),
      },
    );
    await showForm(
      tester,
      client,
      extraOverrides: [placeSearchProvider.overrideWithValue(search)],
    );
    await enterVisible(tester, const ValueKey('event-form-title'), 'Walk');
    await enterVisible(tester, const ValueKey('event-form-search'), 'fed');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();
    expect(search.queries, ['fed']);
    expect(find.text('Federation Wharf'), findsOneWidget);
    await tapVisible(tester, const ValueKey('event-form-suggestion-p1'));
    await tester.pump();
    await tester.pump();
    expect(search.resolved, ['p1']);
    expect(
      find.text('Swanston St & Flinders St, Melbourne VIC 3000'),
      findsOneWidget,
    );
    expect(find.text('Federation Wharf'), findsNothing);
    await tapVisible(tester, const ValueKey('event-form-submit'));
    await tester.pump();
    await tester.pump();
    final draft = client.lastDraft!;
    expect(draft.placeName, 'Federation Square');
    expect(draft.point.lat, -37.818);
    expect(draft.point.lng, 144.9691);
  });

  testWidgets('a refused address search says so and leaves the other ways', (
    tester,
  ) async {
    final client = FakeUserEventsClient();
    final search = FakePlaceSearch(
      failure: 'This API project is not authorized to use this API.',
    );
    await showForm(
      tester,
      client,
      extraOverrides: [placeSearchProvider.overrideWithValue(search)],
    );
    await enterVisible(tester, const ValueKey('event-form-search'), 'fed');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();
    expect(
      find.byKey(const ValueKey('event-form-search-error')),
      findsOneWidget,
    );
    expect(find.textContaining('not authorized'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('event-form-pick-on-map')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('event-form-use-centre')), findsOneWidget);
  });

  testWidgets('without place search the search field is absent', (
    tester,
  ) async {
    final client = FakeUserEventsClient();
    await showForm(tester, client);
    expect(find.byKey(const ValueKey('event-form-search')), findsNothing);
    expect(find.byKey(const ValueKey('event-form-use-selected')), findsNothing);
  });
}

Map<String, dynamic> _fixture(String name) =>
    jsonDecode(
          File(
            '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
          ).readAsStringSync(),
        )
        as Map<String, dynamic>;

/// A sensor with a point geometry from the map contract's sample viewport.
MapItem _pointRecord() => ViewportResponse.fromJson(_fixture('viewport')).layers
    .expand((layer) => layer.items)
    .firstWhere((item) => item.id == 'sample.sensor.A');

/// A selection controller that already holds one selected record.
final class _SelectedRecord extends SelectionController {
  _SelectedRecord(this.item);

  final MapItem item;

  @override
  MapSelectionState build() =>
      MapSelectionState(selectedItemId: item.id, item: item);
}
