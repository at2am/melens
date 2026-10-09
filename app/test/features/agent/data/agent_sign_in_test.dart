import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_sign_in.dart';

final class _FakeUser extends Fake implements User {
  _FakeUser(this.token, {this.error});

  final String? token;
  final Object? error;

  @override
  Future<String?> getIdToken([bool forceRefresh = false]) async {
    if (error case final error?) throw error;
    return token;
  }
}

final class _FakeCredential extends Fake implements UserCredential {
  _FakeCredential(this.user);

  @override
  final User? user;
}

final class _FakeAuth extends Fake implements FirebaseAuth {
  _FakeAuth({this.restored, this.gate});

  /// The user the SDK restores from storage, if any.
  final User? restored;

  /// Holds [signInAnonymously] until it completes.
  final Completer<void>? gate;
  Object? signInError;
  int signIns = 0;

  @override
  Stream<User?> authStateChanges() => Stream.value(restored);

  @override
  Future<UserCredential> signInAnonymously() async {
    signIns++;
    await gate?.future;
    if (signInError case final error?) throw error;
    return _FakeCredential(_FakeUser('anonymous-token'));
  }
}

void main() {
  group('AnonymousSignIn', () {
    test('reuses the restored user instead of signing in again', () async {
      final auth = _FakeAuth(restored: _FakeUser('restored-token'));
      final signIn = AnonymousSignIn(() async => auth);

      expect(await signIn.idToken(), 'restored-token');
      expect(await signIn.idToken(), 'restored-token');
      expect(auth.signIns, 0);
    });

    test('signs in anonymously once, even for overlapping calls', () async {
      final gate = Completer<void>();
      final auth = _FakeAuth(gate: gate);
      final signIn = AnonymousSignIn(() async => auth);

      final first = signIn.idToken();
      final second = signIn.idToken();
      gate.complete();

      expect(await Future.wait([first, second]), [
        'anonymous-token',
        'anonymous-token',
      ]);
      expect(auth.signIns, 1);
    });

    test('a failed sign-in is tried again on the next call', () async {
      final auth = _FakeAuth()
        ..signInError = FirebaseAuthException(code: 'internal-error');
      final signIn = AnonymousSignIn(() async => auth);

      await expectLater(
        signIn.idToken(),
        throwsA(isA<FirebaseAuthException>()),
      );
      auth.signInError = null;
      expect(await signIn.idToken(), 'anonymous-token');
      expect(auth.signIns, 2);
    });

    test('a missing ID token is a failure, not an empty token', () async {
      final signIn = AnonymousSignIn(
        () async => _FakeAuth(restored: _FakeUser(null)),
      );

      await expectLater(
        signIn.idToken(),
        throwsA(isA<FirebaseAuthException>()),
      );
    });
  });

  group('anonymousTokenSource', () {
    AgentTokenSource sourceOf(_FakeUser user) => anonymousTokenSource(
      AnonymousSignIn(() async => _FakeAuth(restored: user)),
    );

    test('passes the ID token through', () async {
      expect(await sourceOf(_FakeUser('id-token'))(), 'id-token');
    });

    test('a network failure is a retryable network error', () async {
      final source = sourceOf(
        _FakeUser(
          null,
          error: FirebaseAuthException(code: 'network-request-failed'),
        ),
      );
      await expectLater(source(), throwsA(isA<AgentNetworkException>()));
    });

    test('any other failure is a retryable sign-in failure', () async {
      for (final error in [
        FirebaseAuthException(code: 'operation-not-allowed'),
        const FormatException('unexpected'),
      ]) {
        await expectLater(
          sourceOf(_FakeUser(null, error: error))(),
          throwsA(isA<AgentSignInFailedException>()),
          reason: '$error',
        );
      }
      expect(const AgentSignInFailedException().retryable, isTrue);
    });
  });

  group('firebaseOptionsFor', () {
    final env = Env(
      environment: AppEnvironment.dev,
      agentBaseUrl: Uri.parse('http://localhost:8080'),
      mapBaseUrl: Uri.parse('http://localhost:8081'),
      firebaseProjectId: 'melens-test',
      firebaseMessagingSenderId: '1234',
      firebaseWebApiKey: 'web-key',
      firebaseWebAppId: '1:1234:web:abc',
      firebaseIosApiKey: 'ios-key',
      firebaseIosAppId: '1:1234:ios:abc',
    );

    tearDown(() => debugDefaultTargetPlatformOverride = null);

    test('uses the configuration of the running platform', () {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      final options = firebaseOptionsFor(env)!;
      expect(options.apiKey, 'ios-key');
      expect(options.appId, '1:1234:ios:abc');
      expect(options.projectId, 'melens-test');
      expect(options.messagingSenderId, '1234');
      expect(options.iosBundleId, 'com.at2am.melens');
      expect(options.authDomain, isNull);
    });

    test('is null for a platform without a configuration', () {
      for (final platform in [TargetPlatform.android, TargetPlatform.macOS]) {
        debugDefaultTargetPlatformOverride = platform;
        expect(firebaseOptionsFor(env), isNull, reason: '$platform');
      }
    });
  });
}
