import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/map/state/zoom_policy.dart';
import 'package:melens/features/map/state/zoom_presentation.dart';

void main() {
  test('initial camera uses nominal bands and a supported wire zoom', () {
    for (final zoom in [0.0, 10.999, 11.0, 13.999, 14.0, 16.999, 17.0, 22.0]) {
      final presentation = ZoomPresentation.initial(zoom);
      expect(presentation.cameraZoom, zoom);
      expect(presentation.band, ZoomPolicy.nominalBand(zoom));
      expect(
        ZoomPolicy.nominalBand(presentation.requestZoom),
        presentation.band,
      );
    }
  });

  for (final boundary in [11.0, 14.0, 17.0]) {
    for (final initialZoom in [boundary - 0.3, boundary + 0.3]) {
      test('wire granularity stays stable across five cycles at $boundary '
          'from $initialZoom', () {
        var presentation = ZoomPresentation.initial(initialZoom);
        final band = presentation.band;
        final wireZoom = presentation.requestZoom;
        for (var cycle = 0; cycle < 5; cycle++) {
          for (final zoom in [boundary + 0.1, boundary - 0.1]) {
            presentation = presentation.at(zoom);
            expect(presentation.cameraZoom, zoom);
            expect(presentation.band, band);
            expect(presentation.requestZoom, wireZoom);
          }
        }
      });
    }
  }

  test(
    'crossing a buffered boundary changes only the next request context',
    () {
      final snapshotPresentation = ZoomPresentation.initial(13.7);
      final retained = snapshotPresentation.at(14.2);
      expect(retained.band, ZoomBand.district);
      final next = retained.at(14.200001);
      expect(next.band, ZoomBand.neighbourhood);
      expect(next.requestZoom, 15);
      expect(snapshotPresentation.cameraZoom, 13.7);
      expect(snapshotPresentation.requestZoom, 12);
      expect(next.at(13.8).band, ZoomBand.neighbourhood);
      expect(next.at(13.799999).band, ZoomBand.district);
    },
  );

  test(
    'camera jumps establish a supported request band without clamping camera',
    () {
      final close = ZoomPresentation.initial(0).at(22);
      expect(close.cameraZoom, 22);
      expect(close.requestZoom, 18);
      final far = close.at(0);
      expect(far.cameraZoom, 0);
      expect(far.requestZoom, 10);
    },
  );

  test(
    'invalid zoom cannot become a request or replace a captured context',
    () {
      final original = ZoomPresentation.initial(14);
      for (final zoom in [double.nan, double.infinity, -0.01, 22.01]) {
        expect(() => ZoomPresentation.initial(zoom), throwsArgumentError);
        expect(() => original.at(zoom), throwsArgumentError);
      }
      expect(original.cameraZoom, 14);
      expect(original.band, ZoomBand.neighbourhood);
    },
  );
}
