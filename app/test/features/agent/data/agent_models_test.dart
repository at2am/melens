import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/agent/data/agent_models.dart';

Map<String, dynamic> envelope(
  String event,
  int seq,
  Map<String, dynamic> body,
) => {'event': event, 'turnId': 't_8f3c', 'seq': seq, ...body};

const usageJson = {
  'calls': 3,
  'input': 15930,
  'cachedInput': 8192,
  'output': 410,
  'thoughts': 1300,
  'toolUseInput': 0,
  'total': 17640,
};

const cardJson = {
  'id': 'c_1',
  'type': 'plan',
  'title': 'A quiet walk',
  'intro': 'Forty minutes, mostly in the gardens.',
  'items': [
    {
      'title': 'Fitzroy Gardens',
      'summary': 'Start under the elms.',
      'source': {'feature_id': 'event:tm-1'},
      'time': {'from': '2026-10-10T18:00:00+11:00'},
      'location': {'lat': -37.8137, 'lng': 144.9803},
      'cost': 'Free',
      'getting_there': 'Tram 48',
    },
    {
      'title': 'Conservatory',
      'source': {'url': 'https://maps.google.com/?cid=2', 'title': 'Maps'},
      'place_id': 'ChIJ1',
    },
  ],
  'attribution': {
    'google_maps': [
      {'place_id': 'ChIJ1', 'maps_uri': 'https://maps.google.com/?cid=2'},
    ],
  },
};

void main() {
  group('events', () {
    test('every event type decodes with its envelope', () {
      final events = [
        envelope('status', 0, {'text': 'Searching the map'}),
        envelope('text', 1, {'delta': 'Near you'}),
        envelope('ui_action', 2, {
          'action': 'focus_map',
          'args': {
            'target': {
              'point': {'lat': -37.81, 'lng': 144.96},
            },
            'zoom': 16,
          },
        }),
        envelope('card', 3, {'card': cardJson}),
        envelope('question', 4, {
          'question': {
            'id': 'q_1',
            'text': 'Which gardens?',
            'options': ['Fitzroy Gardens', 'Carlton Gardens'],
            'allowFreeText': true,
          },
        }),
        envelope('usage', 5, {
          'call': {
            'index': 3,
            'agent': 'map_agent',
            'model': 'gemini-3.8-flash',
            'input': 6210,
            'cachedInput': 4096,
            'output': 182,
            'thoughts': 540,
            'toolUseInput': 0,
            'total': 6932,
            'durationMs': 1870,
          },
          'turn': usageJson,
        }),
        envelope('done', 6, {
          'stop': 'asked',
          'usage': {...usageJson, 'complete': true},
        }),
        envelope('error', 7, {
          'message': 'The agent could not finish this turn',
          'retryable': true,
          'usage': {...usageJson, 'complete': false},
        }),
      ].map(AgentEvent.fromJson).toList();

      expect(events.map((event) => event.seq), [0, 1, 2, 3, 4, 5, 6, 7]);
      expect(events.every((event) => event.turnId == 't_8f3c'), isTrue);
      expect(events[0], isA<AgentStatusEvent>());
      expect((events[1] as AgentTextEvent).delta, 'Near you');
      final action = events[2] as AgentUiActionEvent;
      expect(action.action, UiActionName.focusMap);
      expect(action.args['zoom'], 16);
      final card = (events[3] as AgentCardEvent).card;
      expect(card.type, CardType.plan);
      expect(
        card.items.first.source,
        const FeatureCardSource(featureId: 'event:tm-1'),
      );
      expect(card.items.first.gettingThere, 'Tram 48');
      expect(card.items.first.time?.from, '2026-10-10T18:00:00+11:00');
      expect(card.items.first.time?.to, isNull);
      expect(
        card.items.last.source,
        const LinkCardSource(
          url: 'https://maps.google.com/?cid=2',
          title: 'Maps',
        ),
      );
      expect(card.items.last.placeId, 'ChIJ1');
      expect(card.hasGoogleMapsAttribution, isTrue);
      final question = (events[4] as AgentQuestionEvent).question;
      expect(question.options, ['Fitzroy Gardens', 'Carlton Gardens']);
      final usage = events[5] as AgentUsageEvent;
      expect(usage.call.cachedInput, 4096);
      expect(usage.turn.total, 17640);
      final done = events[6] as AgentDoneEvent;
      expect(done.stop, StopReason.asked);
      expect(done.usage.complete, isTrue);
      final error = events[7] as AgentErrorEvent;
      expect(error.retryable, isTrue);
      expect(error.usage.complete, isFalse);
    });

    test('an unknown event or a missing field is rejected', () {
      expect(
        () => AgentEvent.fromJson(envelope('ping', 0, {})),
        throwsA(anything),
      );
      expect(
        () => AgentEvent.fromJson(envelope('text', 0, {})),
        throwsA(anything),
      );
    });

    test('a card source must cite a feature id or a url', () {
      expect(() => CardSource.fromJson({'title': 'x'}), throwsFormatException);
      expect(const LinkCardSource(url: 'https://a.example').toJson(), {
        'url': 'https://a.example',
      });
    });
  });

  group('requests', () {
    const context = RequestContext(
      viewport: AgentViewport(
        north: -37.80,
        south: -37.82,
        east: 144.98,
        west: 144.95,
      ),
      zoom: 15,
      userLocation: AgentLatLng(lat: -37.8136, lng: 144.9631),
      selected: SelectedContext(),
      layers: ['pedestrian', 'event'],
      localTime: '2026-10-10T18:40:00+11:00',
    );

    test('a text turn serialises exactly as the server schema expects', () {
      final json = const TurnRequest(
        input: TurnInput.text(text: 'Plan a free 45-minute walk near me'),
        context: context,
      ).toJson();

      expect(json, {
        'input': {'kind': 'text', 'text': 'Plan a free 45-minute walk near me'},
        'context': {
          'viewport': {
            'north': -37.80,
            'south': -37.82,
            'east': 144.98,
            'west': 144.95,
          },
          'zoom': 15.0,
          'userLocation': {'lat': -37.8136, 'lng': 144.9631},
          'selected': {'featureId': null, 'point': null},
          'layers': ['pedestrian', 'event'],
          'localTime': '2026-10-10T18:40:00+11:00',
        },
      });
    });

    test('optional context fields are omitted rather than sent as null', () {
      final json = const RequestContext(
        viewport: AgentViewport(north: 1, south: 0, east: 1, west: 0),
        zoom: 12,
        layers: [],
        localTime: '2026-10-10T18:40:00+11:00',
      ).toJson();

      expect(json.keys, ['viewport', 'zoom', 'layers', 'localTime']);
    });

    test('the other input kinds carry their discriminator', () {
      expect(const TurnInput.area(lat: -37.81, lng: 144.96).toJson(), {
        'kind': 'area',
        'lat': -37.81,
        'lng': 144.96,
      });
      expect(const TurnInput.analyse(featureId: 'anomaly:1').toJson(), {
        'kind': 'analyse',
        'featureId': 'anomaly:1',
      });
      expect(
        const TurnInput.answer(questionId: 'q_1', value: 'Fitzroy').toJson(),
        {'kind': 'answer', 'questionId': 'q_1', 'value': 'Fitzroy'},
      );
      expect(
        TurnInput.fromJson({'kind': 'analyse', 'featureId': 'anomaly:1'}),
        const TurnInput.analyse(featureId: 'anomaly:1'),
      );
    });
  });

  group('sessions', () {
    test('a session detail restores stored turns', () {
      final detail = SessionDetail.fromJson({
        'session': {
          'id': 's_1',
          'title': 'What is around here?',
          'createdAt': '2026-10-10T07:00:00.000Z',
          'updatedAt': '2026-10-10T07:05:00.000Z',
          'turnCount': 1,
        },
        'pendingQuestion': {
          'id': 'q_1',
          'text': 'Which gardens?',
          'options': ['A', 'B'],
          'allowFreeText': false,
        },
        'turns': [
          {
            'id': 't_1',
            'seq': 1,
            'createdAt': '2026-10-10T07:04:00.000Z',
            'input': {'kind': 'text', 'text': 'What is around here?'},
            'text': 'A market and a library.',
            'cards': [cardJson],
            'uiActions': [
              {
                'action': 'highlight_features',
                'args': {
                  'ids': ['event:tm-1'],
                  'clear_previous': true,
                  'missing': <String>[],
                },
              },
            ],
            'question': null,
            'stop': 'end',
            'trace': [
              {
                'tool': 'search_features',
                'args': {'area': <String, dynamic>{}},
                'status': 'Searching the map',
                'rows': 12,
                'error': null,
                'durationMs': 240,
              },
            ],
            'usage': {
              ...usageJson,
              'complete': true,
              'perCall': <Map<String, dynamic>>[],
            },
          },
        ],
      });

      expect(detail.session.title, 'What is around here?');
      expect(detail.pendingQuestion?.id, 'q_1');
      final turn = detail.turns.single;
      expect(turn.input, const TurnInput.text(text: 'What is around here?'));
      expect(turn.cards.single.id, 'c_1');
      expect(turn.uiActions.single.action, UiActionName.highlightFeatures);
      expect(turn.trace.single.status, 'Searching the map');
      expect(turn.usage.complete, isTrue);
      expect(turn.usage.perCall, isEmpty);
      expect(turn.stop, StopReason.end);
    });
  });
}
