import 'package:flutter/services.dart';

/// Hands the Maps SDK for iOS its API key at runtime.
///
/// The key comes from the build configuration (`GOOGLE_MAPS_IOS_API_KEY`), so
/// it is never committed (AGENTS.md, hard rule 5). `AppDelegate.swift` receives
/// it on this channel and calls `GMSServices.provideAPIKey`, which must happen
/// before the first native map is created.
class NativeMapsKey {
  const NativeMapsKey({MethodChannel channel = _channel}) : _method = channel;

  static const _channel = MethodChannel('melens/maps');

  final MethodChannel _method;

  Future<void> provide(String apiKey) async {
    await _method.invokeMethod<void>('provideApiKey', apiKey);
  }
}
