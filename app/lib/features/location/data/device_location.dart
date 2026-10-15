import 'dart:convert';

import '../../agent/data/agent_models.dart';
import 'device_location_stub.dart'
    if (dart.library.js_interop) 'device_location_web.dart'
    as platform;

enum DeviceLocationFailure {
  /// The user refused the permission request.
  denied,

  /// The device could not work out a position.
  unavailable,

  /// No answer within the timeout.
  timeout,

  /// This platform or build has no way to ask.
  unsupported,
}

final class DeviceLocationException implements Exception {
  const DeviceLocationException(this.failure);

  final DeviceLocationFailure failure;

  @override
  String toString() => 'DeviceLocationException(${failure.name})';
}

/// Where the device is, once, on request. The position is held in memory by
/// the caller and never written anywhere.
typedef DeviceLocationReader = Future<AgentLatLng> Function();

/// The browser's Geolocation API on the Web; unsupported elsewhere.
Future<AgentLatLng> readDeviceLocation() async {
  final String raw;
  try {
    raw = await platform.readPosition();
  } on UnsupportedError {
    throw const DeviceLocationException(DeviceLocationFailure.unsupported);
  } on Object catch (error) {
    throw DeviceLocationException(_failureOf(error.toString()));
  }
  try {
    final json = jsonDecode(raw) as Map<String, dynamic>;
    final lat = (json['lat'] as num).toDouble();
    final lng = (json['lng'] as num).toDouble();
    if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180) {
      throw const FormatException('Out of range');
    }
    return AgentLatLng(lat: lat, lng: lng);
  } on Object {
    throw const DeviceLocationException(DeviceLocationFailure.unavailable);
  }
}

DeviceLocationFailure _failureOf(String message) {
  if (message.contains('denied')) return DeviceLocationFailure.denied;
  if (message.contains('timeout')) return DeviceLocationFailure.timeout;
  if (message.contains('unsupported')) return DeviceLocationFailure.unsupported;
  return DeviceLocationFailure.unavailable;
}

bool get supportsDeviceLocation => platform.supportsPosition;
