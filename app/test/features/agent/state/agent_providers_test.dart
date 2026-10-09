import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/features/agent/data/agent_sign_in.dart';
import 'package:melens/features/agent/state/agent_providers.dart';

final class _FakeUser extends Fake implements User {
  @override
  Future<String?> getIdToken([bool forceRefresh = false]) async => 'id-token';
}

final class _FakeAuth extends Fake implements FirebaseAuth {
  @override
  Stream<User?> authStateChanges() => Stream.value(_FakeUser());
}

void main() {
  Env envWith({String? devToken}) => Env(
    environment: AppEnvironment.dev,
    agentBaseUrl: Uri.parse('http://localhost:8080'),
    mapBaseUrl: Uri.parse('http://localhost:8081'),
    agentDevToken: devToken,
  );

  Future<String?> tokenOf({String? devToken, AnonymousSignIn? signIn}) {
    final container = ProviderContainer(
      overrides: [
        envProvider.overrideWithValue(envWith(devToken: devToken)),
        anonymousSignInProvider.overrideWithValue(signIn),
      ],
    );
    addTearDown(container.dispose);
    return container.read(agentTokenSourceProvider)();
  }

  final signIn = AnonymousSignIn(() async => _FakeAuth());

  test('the development token wins, for a local agent', () async {
    expect(await tokenOf(devToken: 'dev', signIn: signIn), 'dev');
  });

  test('otherwise the anonymous user\'s ID token is sent', () async {
    expect(await tokenOf(signIn: signIn), 'id-token');
  });

  test('a build with neither has no token', () async {
    expect(await tokenOf(), isNull);
  });
}
