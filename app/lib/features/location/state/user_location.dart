import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../agent/data/agent_models.dart';
import '../data/device_location.dart';

part 'user_location.g.dart';

enum UserLocationStatus { off, locating, on, failed }

final class UserLocationState {
  const UserLocationState({
    this.status = UserLocationStatus.off,
    this.point,
    this.failure,
    this.sequence = 0,
  });

  final UserLocationStatus status;

  /// Set only while [status] is `on`; held in memory, never stored.
  final AgentLatLng? point;
  final DeviceLocationFailure? failure;

  /// Counts successful fixes, so the map can move to each new one once.
  final int sequence;
}

/// Tests override this with a fake reader.
@Riverpod(keepAlive: true)
DeviceLocationReader deviceLocationReader(Ref ref) => readDeviceLocation;

/// The user's own position, only after they switch it on. While on, the
/// agent's request context carries it; switching it off drops it.
@Riverpod(keepAlive: true)
class UserLocation extends _$UserLocation {
  int _attempt = 0;

  @override
  UserLocationState build() => const UserLocationState();

  Future<void> enable() async {
    if (state.status == UserLocationStatus.locating) return;
    final attempt = ++_attempt;
    state = UserLocationState(
      status: UserLocationStatus.locating,
      sequence: state.sequence,
    );
    try {
      final point = await ref.read(deviceLocationReaderProvider)();
      if (!ref.mounted || attempt != _attempt) return;
      state = UserLocationState(
        status: UserLocationStatus.on,
        point: point,
        sequence: state.sequence + 1,
      );
    } on DeviceLocationException catch (error) {
      if (!ref.mounted || attempt != _attempt) return;
      state = UserLocationState(
        status: UserLocationStatus.failed,
        failure: error.failure,
        sequence: state.sequence,
      );
    }
  }

  void disable() {
    _attempt++;
    state = UserLocationState(sequence: state.sequence);
  }
}
