import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/data/place_search.dart';
import 'package:melens/features/events/state/user_events_providers.dart';

void main() {
  test('the pin picker starts, takes one tap and hands it over once', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final picker = container.read(userEventPinPickerProvider.notifier);
    expect(container.read(userEventPinPickerProvider).active, isFalse);
    picker.start();
    expect(container.read(userEventPinPickerProvider).active, isTrue);
    picker.place(const AgentLatLng(lat: -37.81, lng: 144.96));
    final state = container.read(userEventPinPickerProvider);
    expect(state.active, isFalse, reason: 'one tap ends the picking');
    expect(state.picked?.lat, -37.81);
    expect(state.picked?.lng, 144.96);
    expect(picker.take()?.lat, -37.81);
    expect(picker.take(), isNull, reason: 'the point is handed over once');
    picker.start();
    picker.cancel();
    expect(container.read(userEventPinPickerProvider).active, isFalse);
    expect(container.read(userEventPinPickerProvider).picked, isNull);
  });

  test('the form draft is kept until a form takes it', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final draft = container.read(userEventFormDraftProvider.notifier);
    expect(container.read(userEventFormDraftProvider), isNull);
    draft.keep(
      UserEventFormSnapshot(
        editing: null,
        title: 'Walk',
        description: '',
        placeName: '',
        start: DateTime.utc(2026, 10, 12, 7),
        end: null,
        anonymous: true,
        capacity: '',
        point: const AgentLatLng(lat: -37.81, lng: 144.96),
      ),
    );
    expect(container.read(userEventFormDraftProvider)?.title, 'Walk');
    expect(draft.take()?.anonymous, isTrue);
    expect(draft.take(), isNull);
  });

  test('place search is unavailable without a browser Maps key', () {
    final container = ProviderContainer(
      overrides: [
        envProvider.overrideWithValue(
          Env(
            environment: AppEnvironment.dev,
            agentBaseUrl: Uri.parse('http://localhost:8080'),
            mapBaseUrl: Uri.parse('http://localhost:8081'),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    final search = container.read(placeSearchProvider);
    expect(search.isAvailable, isFalse);
    expect(
      () => search.suggest(
        'Federation',
        near: const AgentLatLng(lat: -37.81, lng: 144.96),
      ),
      throwsA(isA<PlaceSearchUnavailableException>()),
    );
  });
}
