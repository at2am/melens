import 'public_source_opener_stub.dart'
    if (dart.library.js_interop) 'public_source_opener_web.dart'
    as platform;

bool isPublicSourceUri(Uri uri) =>
    (uri.scheme == 'http' || uri.scheme == 'https') &&
    uri.host.isNotEmpty &&
    uri.userInfo.isEmpty;

bool get supportsPublicSourceOpening => platform.supportsPublicSourceOpening;

/// Native presentation keeps a selectable URL when no public opener exists.
void openPublicSource(Uri uri) {
  if (isPublicSourceUri(uri)) platform.openPublicSource(uri);
}
