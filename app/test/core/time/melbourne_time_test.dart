import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/time/melbourne_time.dart';

void main() {
  test('now is Melbourne time in daylight saving (AEDT)', () {
    final clock = MelbourneClock(now: () => DateTime.utc(2026, 10, 10, 7, 40));

    expect(clock.now().toProtocolString(), '2026-10-10T18:40:00+11:00');
  });

  test('now is Melbourne time in standard time (AEST)', () {
    final clock = MelbourneClock(now: () => DateTime.utc(2026, 7, 1, 0, 30));

    expect(clock.now().toProtocolString(), '2026-07-01T10:30:00+10:00');
  });

  test('converts times across the daylight saving change', () {
    final clock = MelbourneClock();

    // Clocks go forward at 2 am on Sunday 4 October 2026.
    expect(
      clock.toMelbourne(DateTime.utc(2026, 10, 3, 15, 59)).toProtocolString(),
      '2026-10-04T01:59:00+10:00',
    );
    expect(
      clock.toMelbourne(DateTime.utc(2026, 10, 3, 16)).toProtocolString(),
      '2026-10-04T03:00:00+11:00',
    );
  });

  test('parses protocol times back to the same instant', () {
    final clock = MelbourneClock();
    final time = clock.toMelbourne(DateTime.utc(2026, 10, 10, 8, 30));

    expect(
      DateTime.parse(time.toProtocolString()),
      DateTime.utc(2026, 10, 10, 8, 30),
    );
  });
}
