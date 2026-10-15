/// Decodes a Google encoded polyline (precision 5) into `(lat, lng)` pairs.
///
/// Throws a [FormatException] for a truncated or non-polyline string, so a
/// bad route is never drawn as a partial line.
List<({double lat, double lng})> decodePolyline(String encoded) {
  final points = <({double lat, double lng})>[];
  var index = 0;
  var lat = 0;
  var lng = 0;

  int nextValue() {
    var result = 0;
    var shift = 0;
    while (true) {
      if (index >= encoded.length) {
        throw FormatException('Truncated polyline', encoded, index);
      }
      final byte = encoded.codeUnitAt(index++) - 63;
      if (byte < 0 || byte > 63) {
        throw FormatException('Invalid polyline character', encoded, index - 1);
      }
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
      if (shift > 35) {
        throw FormatException('Polyline value too long', encoded, index);
      }
    }
    return (result & 1) != 0 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    lat += nextValue();
    lng += nextValue();
    points.add((lat: lat / 1e5, lng: lng / 1e5));
  }
  return points;
}
