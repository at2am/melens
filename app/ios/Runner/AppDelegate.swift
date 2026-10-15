import Flutter
import GoogleMaps
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    // The Maps key comes from the build configuration, not from the project
    // (AGENTS.md, hard rule 5). Dart sends it before the first map is built.
    let channel = FlutterMethodChannel(
      name: "melens/maps",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    channel.setMethodCallHandler { call, result in
      guard call.method == "provideApiKey",
        let key = call.arguments as? String, !key.isEmpty
      else {
        result(FlutterMethodNotImplemented)
        return
      }
      GMSServices.provideAPIKey(key)
      result(nil)
    }
  }
}
