import 'dart:js_interop';

@JS('melensGetPosition')
external JSPromise<JSString> _getPosition();

bool get supportsPosition => true;

Future<String> readPosition() async => (await _getPosition().toDart).toDart;
