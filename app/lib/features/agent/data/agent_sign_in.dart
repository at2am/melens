import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:logging/logging.dart';

import '../../../core/config/env.dart';
import 'agent_client.dart';

final _log = Logger('agentSignIn');

/// The iOS bundle id and Android application id (app README).
const _appId = 'com.at2am.melens';

/// Anonymous Firebase sign-in for the agent's ID tokens
/// (agent-protocol.md, Authentication).
///
/// The uid keys the user's saved sessions, so the user the SDK persisted is
/// reused (IndexedDB on the web, the keychain or app storage on phones), and
/// only a device without one signs in anonymously.
final class AnonymousSignIn {
  AnonymousSignIn(this._auth);

  final Future<FirebaseAuth> Function() _auth;
  Future<User>? _user;

  /// The user's ID token; the SDK refreshes it shortly before it expires.
  Future<String> idToken() async {
    final pending = _user ??= _signIn();
    try {
      final token = await (await pending).getIdToken();
      if (token != null && token.isNotEmpty) return token;
      throw FirebaseAuthException(code: 'no-id-token');
    } catch (_) {
      // The next call signs in again instead of repeating this failure.
      if (identical(_user, pending)) _user = null;
      rethrow;
    }
  }

  Future<User> _signIn() async {
    final auth = await _auth();
    // The SDK restores a persisted user asynchronously, and the first auth
    // state is that user or null. Signing in before it arrives would replace
    // the user, and with it every saved session.
    final restored = await auth.authStateChanges().first;
    if (restored != null) return restored;
    final user = (await auth.signInAnonymously()).user;
    if (user == null) throw FirebaseAuthException(code: 'no-user');
    return user;
  }
}

/// The agent's token source over [signIn]. Failures become the client's own
/// exceptions, so the chat panel explains them and offers a retry.
AgentTokenSource anonymousTokenSource(AnonymousSignIn signIn) => () async {
  try {
    return await signIn.idToken();
  } on FirebaseException catch (error) {
    _log.warning('Anonymous sign-in failed: ${error.code}');
    if (error.code == 'network-request-failed') {
      throw const AgentNetworkException();
    }
    throw const AgentSignInFailedException();
  } on Exception catch (error) {
    _log.warning('Anonymous sign-in failed: ${error.runtimeType}');
    throw const AgentSignInFailedException();
  }
};

/// The [FirebaseOptions] of the platform this build runs on; null when the
/// build has no Firebase configuration for it.
FirebaseOptions? firebaseOptionsFor(Env env) {
  final platform = kIsWeb
      ? FirebasePlatform.web
      : switch (defaultTargetPlatform) {
          TargetPlatform.android => FirebasePlatform.android,
          TargetPlatform.iOS => FirebasePlatform.ios,
          _ => null,
        };
  final config = platform == null ? null : env.firebase[platform];
  if (config == null) return null;
  return FirebaseOptions(
    apiKey: config.apiKey,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
    projectId: config.projectId,
    authDomain: platform == FirebasePlatform.web
        ? '${config.projectId}.firebaseapp.com'
        : null,
    iosBundleId: platform == FirebasePlatform.ios ? _appId : null,
  );
}

/// Starts Firebase with [options] once, then hands out its Auth instance.
Future<FirebaseAuth> firebaseAuthFor(FirebaseOptions options) async {
  final app = Firebase.apps.isEmpty
      ? await Firebase.initializeApp(options: options)
      : Firebase.app();
  return FirebaseAuth.instanceFor(app: app);
}
