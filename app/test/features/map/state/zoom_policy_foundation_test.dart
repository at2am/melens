import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/map/state/zoom_policy.dart';

void main() {
  group('first view', () {
    final nominalCases = <(double, ZoomBand)>[
      (0, ZoomBand.overview),
      (10.999999, ZoomBand.overview),
      (11, ZoomBand.district),
      (11.1, ZoomBand.district),
      (13.999999, ZoomBand.district),
      (14, ZoomBand.neighbourhood),
      (14.1, ZoomBand.neighbourhood),
      (16.999999, ZoomBand.neighbourhood),
      (17, ZoomBand.closeUp),
      (17.1, ZoomBand.closeUp),
      (22, ZoomBand.closeUp),
    ];

    for (final (zoom, expected) in nominalCases) {
      test('zoom $zoom starts in $expected without hysteresis', () {
        expect(ZoomPolicy.nominalBand(zoom), expected);
        expect(ZoomPolicy.bandFor(zoom), expected);
      });
    }
  });

  final boundaryCases = <(double, ZoomBand, ZoomBand)>[
    (11, ZoomBand.overview, ZoomBand.district),
    (14, ZoomBand.district, ZoomBand.neighbourhood),
    (17, ZoomBand.neighbourhood, ZoomBand.closeUp),
  ];

  for (final (boundary, farther, closer) in boundaryCases) {
    group('boundary $boundary', () {
      test('inward transition is strictly above boundary + 0.2', () {
        expect(ZoomPolicy.bandFor(boundary, previousBand: farther), farther);
        expect(
          ZoomPolicy.bandFor(boundary + 0.2, previousBand: farther),
          farther,
        );
        expect(
          ZoomPolicy.bandFor(boundary + 0.200001, previousBand: farther),
          closer,
        );
      });

      test('outward transition is strictly below boundary - 0.2', () {
        expect(ZoomPolicy.bandFor(boundary, previousBand: closer), closer);
        expect(
          ZoomPolicy.bandFor(boundary - 0.2, previousBand: closer),
          closer,
        );
        expect(
          ZoomPolicy.bandFor(boundary - 0.200001, previousBand: closer),
          farther,
        );
      });

      for (final startingBand in [farther, closer]) {
        test('five small oscillations retain $startingBand', () {
          var band = startingBand;
          for (var crossing = 0; crossing < 5; crossing++) {
            band = ZoomPolicy.bandFor(boundary + 0.1, previousBand: band);
            expect(band, startingBand, reason: 'Inward crossing $crossing');
            band = ZoomPolicy.bandFor(boundary - 0.1, previousBand: band);
            expect(band, startingBand, reason: 'Outward crossing $crossing');
          }
        });
      }

      test('a real crossing survives return to the nominal boundary', () {
        var band = ZoomPolicy.bandFor(boundary + 0.21, previousBand: farther);
        expect(band, closer);
        band = ZoomPolicy.bandFor(boundary - 0.1, previousBand: band);
        expect(band, closer);
        band = ZoomPolicy.bandFor(boundary - 0.21, previousBand: band);
        expect(band, farther);
        band = ZoomPolicy.bandFor(boundary + 0.1, previousBand: band);
        expect(band, farther);
      });
    });
  }

  group('camera jumps', () {
    for (final previousBand in ZoomBand.values) {
      test('jumps from $previousBand to either supported extreme', () {
        expect(
          ZoomPolicy.bandFor(22, previousBand: previousBand),
          ZoomBand.closeUp,
        );
        expect(
          ZoomPolicy.bandFor(0, previousBand: previousBand),
          ZoomBand.overview,
        );
      });
    }

    test('inward jump stops at an exactly buffered intermediate boundary', () {
      expect(
        ZoomPolicy.bandFor(14.2, previousBand: ZoomBand.overview),
        ZoomBand.district,
      );
      expect(
        ZoomPolicy.bandFor(14.200001, previousBand: ZoomBand.overview),
        ZoomBand.neighbourhood,
      );
      expect(
        ZoomPolicy.bandFor(17.2, previousBand: ZoomBand.overview),
        ZoomBand.neighbourhood,
      );
    });

    test('outward jump stops at an exactly buffered intermediate boundary', () {
      expect(
        ZoomPolicy.bandFor(13.8, previousBand: ZoomBand.closeUp),
        ZoomBand.neighbourhood,
      );
      expect(
        ZoomPolicy.bandFor(13.799999, previousBand: ZoomBand.closeUp),
        ZoomBand.district,
      );
      expect(
        ZoomPolicy.bandFor(10.8, previousBand: ZoomBand.closeUp),
        ZoomBand.district,
      );
    });

    test('successive full-range jumps use the newly returned band', () {
      var band = ZoomPolicy.bandFor(0);
      for (var jump = 0; jump < 5; jump++) {
        band = ZoomPolicy.bandFor(22, previousBand: band);
        expect(band, ZoomBand.closeUp);
        band = ZoomPolicy.bandFor(0, previousBand: band);
        expect(band, ZoomBand.overview);
      }
    });
  });

  group('input validation', () {
    final invalidZooms = <double>[
      double.nan,
      double.infinity,
      double.negativeInfinity,
      -0.000001,
      22.000001,
    ];

    for (final zoom in invalidZooms) {
      test('rejects $zoom on initial and subsequent views', () {
        expect(() => ZoomPolicy.nominalBand(zoom), throwsArgumentError);
        expect(() => ZoomPolicy.bandFor(zoom), throwsArgumentError);
        expect(
          () => ZoomPolicy.bandFor(zoom, previousBand: ZoomBand.district),
          throwsArgumentError,
        );
      });
    }
  });
}
