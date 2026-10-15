bool get supportsPosition => false;

Future<String> readPosition() =>
    Future.error(UnsupportedError('Location needs the browser.'));
