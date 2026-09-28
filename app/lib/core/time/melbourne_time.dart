import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:timezone/data/latest_10y.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

part 'melbourne_time.g.dart';

/// The product's clock.
///
/// Every time the app shows or sends is Melbourne local time (tools.md,
/// Conventions), whatever the device's time zone: a judge in Singapore sees
/// the same "tonight" as a user in Melbourne. Read the time through
/// [melbourneClockProvider], never `DateTime.now()`, so tests can fix it.
final class MelbourneClock {
  MelbourneClock({this._now = DateTime.now});

  final DateTime Function() _now;

  /// `Australia/Melbourne`, loaded from the bundled time zone data on first
  /// use.
  static final tz.Location location = () {
    tzdata.initializeTimeZones();
    return tz.getLocation('Australia/Melbourne');
  }();

  tz.TZDateTime now() => tz.TZDateTime.from(_now(), location);

  tz.TZDateTime toMelbourne(DateTime time) =>
      tz.TZDateTime.from(time, location);
}

@Riverpod(keepAlive: true)
MelbourneClock melbourneClock(Ref ref) => MelbourneClock();

extension ProtocolTime on tz.TZDateTime {
  /// The agent protocol's time format: seconds precision and the offset,
  /// for example `2026-10-10T18:40:00+11:00`.
  String toProtocolString() {
    String two(int n) => n.toString().padLeft(2, '0');
    final offset = timeZoneOffset;
    final offsetMinutes = offset.inMinutes.abs();
    return '${year.toString().padLeft(4, '0')}-${two(month)}-${two(day)}'
        'T${two(hour)}:${two(minute)}:${two(second)}'
        '${offset.isNegative ? '-' : '+'}'
        '${two(offsetMinutes ~/ 60)}:${two(offsetMinutes % 60)}';
  }
}
