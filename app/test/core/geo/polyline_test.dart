import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/geo/polyline.dart';

void main() {
  test('decodes the polyline from Google\'s documentation', () {
    final points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points, hasLength(3));
    expect(points[0].lat, closeTo(38.5, 1e-9));
    expect(points[0].lng, closeTo(-120.2, 1e-9));
    expect(points[1].lat, closeTo(40.7, 1e-9));
    expect(points[1].lng, closeTo(-120.95, 1e-9));
    expect(points[2].lat, closeTo(43.252, 1e-9));
    expect(points[2].lng, closeTo(-126.453, 1e-9));
  });

  test('an empty string has no points', () {
    expect(decodePolyline(''), isEmpty);
  });

  test(
    'a truncated or invalid string throws instead of drawing part of it',
    () {
      expect(() => decodePolyline('_p~iF'), throwsFormatException);
      expect(() => decodePolyline('_p~iF~ps|'), throwsFormatException);
      expect(() => decodePolyline('ab cd'), throwsFormatException);
    },
  );
}
