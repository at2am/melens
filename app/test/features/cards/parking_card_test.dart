import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/cards/ui/card_registry.dart';
import 'package:melens/l10n/app_localizations.dart';

/// A `find_parking` card as the agent sends it (agent-protocol.md, UC-15).
Map<String, dynamic> parkingCard({bool rules = true}) => {
  'id': 'c_1',
  'type': 'list',
  'title': 'Parking near Melbourne Central',
  'intro': '2 bays read vacant within 400 m.',
  'items': [
    for (final (index, metres) in [(0, 60), (1, 1240)])
      {
        'title': 'Vacant bay',
        'summary': 'Live sensor: vacant.',
        'source': {'feature_id': 'parking:kerbside:$index'},
        'location': {'lat': -37.8097, 'lng': 144.9628},
        if (rules) 'cost': r'$7.10 an hour',
        'getting_there': '$metres m, about 1 min walk to Melbourne Central',
        'parking': {
          'state': 'vacant',
          'recommended': index == 0,
          'distance_m': metres,
          'walk_min': index == 0 ? 1 : 16,
          'destination': index == 0 ? 'Melbourne Central' : null,
          'reported_at': '2026-10-10T18:38:00+11:00',
          'zone': 7012,
          'fee': rules ? r'$7.10 an hour' : null,
          'time_limit': rules ? 'Mostly 1P to 2P' : null,
          'hours': rules ? 'Mon to Sat, 7:30 am to 6:30 pm' : null,
          'payment': null,
          'policy_scope': rules ? 'area' : 'unknown',
          'policy_url': rules ? 'https://www.melbourne.vic.gov.au/fees' : null,
        },
      },
  ],
};

Future<void> showCard(WidgetTester tester, Map<String, dynamic> json) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        melbourneClockProvider.overrideWithValue(
          MelbourneClock(now: () => DateTime.utc(2026, 10, 10, 7, 40)),
        ),
      ],
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 400,
              child: buildAgentCard(AgentCard.fromJson(json)),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  test('a parking item decodes and round-trips; other items have none', () {
    final card = AgentCard.fromJson(parkingCard());
    final parking = card.items.first.parking!;
    expect(parking.state, CardParkingState.vacant);
    expect(parking.recommended, isTrue);
    expect(parking.distanceMetres, 60);
    expect(parking.policyScope, CardParkingPolicyScope.area);
    expect(parking.timeLimit, 'Mostly 1P to 2P');
    expect(
      AgentCard.fromJson(card.toJson()).items.first.parking!.fee,
      r'$7.10 an hour',
    );
    expect(
      CardItem.fromJson({
        'title': 'Hamer Hall',
        'source': {'feature_id': 'event:1'},
      }).parking,
      isNull,
    );
  });

  testWidgets(
    'each bay shows its reading, distance to the destination and the area '
    'rules on labelled lines, and the best match stands out',
    (tester) async {
      await showCard(tester, parkingCard());
      expect(find.byKey(const ValueKey('parking-card-item')), findsNWidgets(2));
      expect(find.byKey(const ValueKey('parking-card-best')), findsOneWidget);
      expect(find.text('Vacant now'), findsNWidgets(2));
      expect(
        find.text('60 m to Melbourne Central, about 1 min walk'),
        findsOneWidget,
      );
      expect(
        find.text('1.2 km to your destination, about 16 min walk'),
        findsOneWidget,
      );
      expect(find.text('Fee'), findsNWidgets(2));
      expect(find.text(r'$7.10 an hour'), findsNWidgets(2));
      expect(find.text('Time limit'), findsNWidgets(2));
      expect(find.text('Mon to Sat, 7:30 am to 6:30 pm'), findsNWidgets(2));
      expect(find.text('Pay by'), findsNothing, reason: 'no payment given');
      expect(
        find.text(
          'Published rules for this area. The sign at the bay decides.',
        ),
        findsNWidgets(2),
      );
      expect(find.text('Zone 7012 · Sensor reported 18:38'), findsNWidgets(2));
      // The generic cost and directions lines are not repeated.
      expect(find.textContaining('Cost:'), findsNothing);
      expect(find.textContaining('Getting there:'), findsNothing);
    },
  );

  testWidgets('without published rules the bay says to check the sign', (
    tester,
  ) async {
    await showCard(tester, parkingCard(rules: false));
    expect(find.text('Fee'), findsNothing);
    expect(
      find.text(
        'Fee and time limit not published for this bay. Check the sign at '
        'the bay.',
      ),
      findsNWidgets(2),
    );
  });
}
