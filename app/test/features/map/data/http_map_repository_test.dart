import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:melens/features/map/data/http_map_repository.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';

Map<String, dynamic> fixture(String name) => jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
  ).readAsStringSync(),
) as Map<String, dynamic>;

http.Response response(Map<String, dynamic> json, {int status = 200}) =>
    http.Response(
      jsonEncode(json),
      status,
      headers: {'content-type': 'application/json'},
    );

HttpMapRepository sampleHttp(
  http.Client client, {
  Duration timeout = const Duration(seconds: 30),
}) => HttpMapRepository(
  client: client,
  baseUrl: Uri.parse('https://map.example/service/'),
  expectedDataMode: MapDataMode.sample,
  requestTimeout: timeout,
);

void main() {
  test('catalog and viewport decode canonical typed observations', () async {
    final query = ViewportQuery.fromJson(fixture('viewport-query'));
    final client = MockClient((request) async {
      expect(request.headers['accept'], 'application/json');
      expect(request.followRedirects, isFalse);
      if (request.method == 'GET') {
        expect(request.url.path, '/service/v1/map/layers');
        expect(request.url.hasQuery, isFalse);
        return response(fixture('catalog'));
      }
      expect(request.method, 'POST');
      expect(request.url.path, '/service/v1/map/viewport');
      expect(request.headers['content-type'], 'application/json');
      expect(jsonDecode(request.body), query.toJson());
      return response(fixture('viewport'));
    });
    addTearDown(client.close);
    final repository = sampleHttp(client);

    final catalog = await repository.getLayers();
    expect(catalog.dataMode, MapDataMode.sample);
    expect(catalog.layers.length, 9);
    final viewport = await repository.queryViewport(query);
    expect(viewport.dataMode, MapDataMode.sample);
    expect(viewport.mode, MapQueryMode.current);
    expect(viewport.requestId, query.requestId);
    final layer = viewport.layers.single;
    expect(layer.coverage.state, MapCoverageState.verified);
    expect(layer.freshness, MapFreshness.current);
    expect(layer.completeness, MapCompleteness.complete);
    expect(layer.unresolvedCount, 1);
    final item = layer.items.first.toJson();
    expect(item['geometry'], {
      'type': 'Point',
      'coordinates': [144.967, -37.818],
    });
    expect(
      layer.items.first.time.observedAt,
      DateTime.parse('2026-10-01T00:59:00Z'),
    );
    expect(layer.items.first.sources.single.sourceId, 'sample.pedestrian');
    expect(
      (layer.items[1].toJson()['details']
          as Map<String, dynamic>)['totalCount'],
      0,
    );
  });

  test(
    'detail ids and snapshot parameters are encoded as opaque data',
    () async {
      const id = 'source/id?query#fragment%';
      const context = MapReadContext(
        requestId: 'request+&=',
        snapshotId: 'snapshot/?&=',
      );
      final client = MockClient((request) async {
        expect(request.url.pathSegments, ['service', 'v1', 'map', 'items', id]);
        expect(request.url.queryParameters, {
          'requestId': context.requestId,
          'snapshotId': context.snapshotId,
        });
        final json = fixture('item')
          ..['requestId'] = context.requestId
          ..['snapshotId'] = context.snapshotId;
        (json['item'] as Map<String, dynamic>)['id'] = id;
        return response(json);
      });
      addTearDown(client.close);

      final item = await sampleHttp(client).getItem(id, context);
      expect(item.item.id, id);
      expect(item.snapshotId, context.snapshotId);
    },
  );

  test('unlocated scopes remain in the list and counts remain null', () async {
    final query = UnlocatedQuery.fromJson({
      'requestId': 'sample-request',
      'layers': ['pedestrian'],
      'mode': 'current',
      'window': fixture('viewport-query')['window'],
      'scope': {'sourceJurisdiction': 'Sample Melbourne source jurisdiction'},
      'areaFilter': null,
      'boundaryFilter': null,
      'pageSize': 100,
    });
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/service/v1/map/unlocated');
      expect(jsonDecode(request.url.queryParameters['query']!), query.toJson());
      return response(fixture('unlocated'));
    });
    addTearDown(client.close);

    final page = await sampleHttp(client).getUnlocated(query);
    expect(page.items.single.geometry, isNull);
    expect(
      page.items.single.location.precision,
      MapLocationPrecision.unlocated,
    );
    expect(
      (page.items.single.toJson()['details']
          as Map<String, dynamic>)['totalCount'],
      isNull,
    );
    expect(page.toJson()['scope'], fixture('unlocated')['scope']);
  });

  test(
    'member continuation retains its snapshot, scope and completeness',
    () async {
      const query = AggregateMembersQuery(
        requestId: 'sample-request',
        snapshotId: 'sample-snapshot',
        cursor: 'member+&=',
        pageSize: 25,
      );
      final client = MockClient((request) async {
        expect(
          request.url.path,
          '/service/v1/map/aggregates/sample.aggregate/members',
        );
        expect(request.url.queryParameters, {
          'requestId': query.requestId,
          'snapshotId': query.snapshotId,
          'cursor': query.cursor,
          'pageSize': '25',
        });
        return response(fixture('members'));
      });
      addTearDown(client.close);

      final page = await sampleHttp(client)
          .getAggregateMembers('sample.aggregate', query);
      expect(page.snapshotId, query.snapshotId);
      expect(page.completeness, MapCompleteness.complete);
      final scope = page.toJson()['scope'] as Map<String, dynamic>;
      final expectedScope = fixture('members')['scope'] as Map<String, dynamic>;
      expect(scope['aggregateId'], expectedScope['aggregateId']);
      expect(scope['bounds'], expectedScope['bounds']);
      expect(scope['unit'], expectedScope['unit']);
      final window = scope['window'] as Map<String, dynamic>;
      final expectedWindow = expectedScope['window'] as Map<String, dynamic>;
      for (final bound in ['from', 'to']) {
        expect(
          DateTime.parse(window[bound] as String),
          DateTime.parse(expectedWindow[bound] as String),
        );
      }
    },
  );

  for (final name in [
    'historical',
    'no-matching',
    'not-covered',
    'partial',
    'unavailable',
    'unknown',
  ]) {
    test('preserves $name envelope semantics', () async {
      final json = fixture(name);
      final queryJson = fixture('viewport-query')
        ..['mode'] = json['mode']
        ..['requestId'] = json['requestId'];
      if (json['window'] != null) queryJson['window'] = json['window'];
      final client = MockClient((_) async => response(json));
      addTearDown(client.close);
      final result = await sampleHttp(client)
          .queryViewport(ViewportQuery.fromJson(queryJson));
      final original = ViewportResponse.fromJson(json);
      expect(result.toJson(), original.toJson());
    });
  }

  test('live HTTP never silently accepts sample data', () async {
    final client = MockClient((_) async => response(fixture('catalog')));
    addTearDown(client.close);
    final repository = HttpMapRepository(
      client: client,
      baseUrl: Uri.parse('https://map.example'),
    );
    await expectLater(
      repository.getLayers(),
      throwsA(
        isA<MapContractException>().having(
          (error) => error.failure,
          'failure',
          MapContractFailure.dataModeMismatch,
        ),
      ),
    );
  });

  for (final version in [null, 0, 2, '1']) {
    test('requires integer schema version 1, rejects $version', () async {
      final json = fixture('catalog')..['schemaVersion'] = version;
      final client = MockClient((_) async => response(json));
      addTearDown(client.close);
      await expectLater(
        sampleHttp(client).getLayers(),
        throwsA(isA<MapContractException>()),
      );
    });
  }

  test('rejects a response from another request or snapshot', () async {
    final json = fixture('item')..['snapshotId'] = 'different-snapshot';
    final client = MockClient((_) async => response(json));
    addTearDown(client.close);
    await expectLater(
      sampleHttp(client).getItem(
        'sample.sensor.A',
        const MapReadContext(
          requestId: 'sample-request',
          snapshotId: 'sample-snapshot',
        ),
      ),
      throwsA(
        isA<MapContractException>().having(
          (error) => error.failure,
          'failure',
          MapContractFailure.requestMismatch,
        ),
      ),
    );
  });

  test('malformed typed items become a safe contract failure', () async {
    final json = fixture('item');
    (json['item'] as Map<String, dynamic>)['geometry'] = {
      'type': 'Point',
      'coordinates': [-37.818, 144.967],
    };
    final client = MockClient((_) async => response(json));
    addTearDown(client.close);
    await expectLater(
      sampleHttp(client).getItem(
        'sample.sensor.A',
        const MapReadContext(
          requestId: 'sample-request',
          snapshotId: 'sample-snapshot',
        ),
      ),
      throwsA(isA<MapContractException>()),
    );
  });

  test(
    'HTTP errors retain typed codes without exposing server bodies',
    () async {
      const secret = 'private-key-in-proxy-error';
      final client = MockClient(
        (_) async => response({
          'error': {
            'code': 'snapshotExpired',
            'messageKey': secret,
            'requestId': 'sample-request',
            'retryable': false,
          },
        }, status: 409),
      );
      addTearDown(client.close);
      await expectLater(
        sampleHttp(client).getLayers(),
        throwsA(
          isA<MapHttpException>()
              .having(
                (error) => error.code,
                'code',
                MapServiceErrorCode.snapshotExpired,
              )
              .having((error) => error.retryable, 'retryable', false)
              .having(
                (error) => error.toString().contains(secret),
                'safe error',
                false,
              ),
        ),
      );
    },
  );

  test('non-JSON proxy failures are safe typed HTTP errors', () async {
    final client = MockClient(
      (_) async => http.Response('<html>secret</html>', 503),
    );
    addTearDown(client.close);
    await expectLater(
      sampleHttp(client).getLayers(),
      throwsA(
        isA<MapHttpException>()
            .having((error) => error.retryable, 'retryable', true)
            .having(
              (error) => error.toString().contains('secret'),
              'safe error',
              false,
            ),
      ),
    );
  });

  test(
    'network errors do not expose endpoint or client exception text',
    () async {
      final client = MockClient(
        (_) async => throw http.ClientException('secret-token'),
      );
      addTearDown(client.close);
      await expectLater(
        sampleHttp(client).getLayers(),
        throwsA(
          isA<MapNetworkException>().having(
            (error) => error.toString().contains('secret'),
            'safe error',
            false,
          ),
        ),
      );
    },
  );

  test(
    'invalid JSON and oversized successful responses are rejected',
    () async {
      final invalid = MockClient((_) async => http.Response('{not-json', 200));
      final oversized = MockClient(
        (_) async => http.Response('x' * (2 * 1024 * 1024 + 1), 200),
      );
      addTearDown(invalid.close);
      addTearDown(oversized.close);
      await expectLater(
        sampleHttp(invalid).getLayers(),
        throwsA(isA<MapContractException>()),
      );
      await expectLater(
        sampleHttp(oversized).getLayers(),
        throwsA(
          isA<MapContractException>().having(
            (error) => error.failure,
            'failure',
            MapContractFailure.responseTooLarge,
          ),
        ),
      );
    },
  );

  test(
    'cancellation rejects an in-flight request without sample fallback',
    () async {
      final started = Completer<void>();
      final pending = Completer<http.Response>();
      final client = MockClient((_) {
        started.complete();
        return pending.future;
      });
      addTearDown(client.close);
      final cancellation = MapRequestCancellation();
      final result = sampleHttp(client).getLayers(cancellation: cancellation);
      await started.future;
      cancellation.cancel();
      cancellation.cancel();
      await expectLater(result, throwsA(isA<MapRequestCancelled>()));
      pending.complete(response(fixture('catalog')));
    },
  );

  test('a cancelled request is never sent', () async {
    final client = MockClient((_) async => fail('Cancelled request was sent.'));
    addTearDown(client.close);
    final cancellation = MapRequestCancellation()..cancel();
    await expectLater(
      sampleHttp(client).getLayers(cancellation: cancellation),
      throwsA(isA<MapRequestCancelled>()),
    );
  });

  test(
    'request deadline reports timeout even for a non-abortable mock',
    () async {
      final pending = Completer<http.Response>();
      final client = MockClient((_) => pending.future);
      addTearDown(client.close);
      await expectLater(
        sampleHttp(
          client,
          timeout: const Duration(milliseconds: 10),
        ).getLayers(),
        throwsA(isA<MapTimeoutException>()),
      );
      pending.complete(response(fixture('catalog')));
    },
  );

  test(
    'invalid endpoint credentials and paging limits are rejected locally',
    () {
      final client = MockClient((_) async => fail('Invalid request was sent.'));
      addTearDown(client.close);
      expect(
        () => HttpMapRepository(
          client: client,
          baseUrl: Uri.parse('https://user:secret@map.example'),
        ),
        throwsA(isA<MapRequestException>()),
      );
      expect(
        () => sampleHttp(client).getAggregateMembers(
          'sample.cell',
          const AggregateMembersQuery(
            requestId: 'request',
            snapshotId: 'snapshot',
            pageSize: 1001,
          ),
        ),
        throwsA(isA<MapRequestException>()),
      );
    },
  );

  test(
    'invalid list scope, window and detail context fail before transport',
    () {
      final client = MockClient((_) async => fail('Invalid request was sent.'));
      addTearDown(client.close);
      final instant = DateTime.utc(2026, 10, 1, 1);
      final validWindow = TimeWindow(
        from: instant.subtract(const Duration(minutes: 1)),
        to: instant,
      );
      final repository = sampleHttp(client);
      for (final query in [
        UnlocatedQuery(
          requestId: 'request',
          layers: const [MapLayerId.pedestrian],
          mode: MapQueryMode.current,
          window: validWindow,
          scope: const UnlocatedScope.areaRefs([]),
        ),
        UnlocatedQuery(
          requestId: 'request',
          layers: const [MapLayerId.pedestrian],
          mode: MapQueryMode.current,
          window: TimeWindow(from: instant, to: instant),
          scope: const UnlocatedScope.sourceJurisdiction('Melbourne'),
        ),
        UnlocatedQuery(
          requestId: 'request',
          layers: const [MapLayerId.pedestrian],
          mode: MapQueryMode.current,
          window: validWindow,
          scope: const UnlocatedScope.sourceJurisdiction('Melbourne'),
          cursor: 'cursor-without-snapshot',
        ),
      ]) {
        expect(
          () => repository.getUnlocated(query),
          throwsA(isA<MapRequestException>()),
        );
      }
      expect(
        () => repository.getItem(
          'sample.sensor.A',
          const MapReadContext(requestId: 'request', snapshotId: ''),
        ),
        throwsA(isA<MapRequestException>()),
      );
    },
  );
}
