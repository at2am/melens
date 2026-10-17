// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chat_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Tests override this to recover without waiting.

@ProviderFor(chatRecoveryTiming)
final chatRecoveryTimingProvider = ChatRecoveryTimingProvider._();

/// Tests override this to recover without waiting.

final class ChatRecoveryTimingProvider
    extends
        $FunctionalProvider<
          ChatRecoveryTiming,
          ChatRecoveryTiming,
          ChatRecoveryTiming
        >
    with $Provider<ChatRecoveryTiming> {
  /// Tests override this to recover without waiting.
  ChatRecoveryTimingProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'chatRecoveryTimingProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$chatRecoveryTimingHash();

  @$internal
  @override
  $ProviderElement<ChatRecoveryTiming> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  ChatRecoveryTiming create(Ref ref) {
    return chatRecoveryTiming(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(ChatRecoveryTiming value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<ChatRecoveryTiming>(value),
    );
  }
}

String _$chatRecoveryTimingHash() =>
    r'86b9525efbd0a7994e950e02ea67cfb03a7002ac';

/// Conversation state: the open session, its turns, the turn in progress,
/// any pending question and the session list (agent-protocol.md, Flutter
/// implementation). One turn runs at a time; a message sent while one runs
/// interrupts it. Events are ordered by `seq`.

@ProviderFor(ChatController)
final chatControllerProvider = ChatControllerProvider._();

/// Conversation state: the open session, its turns, the turn in progress,
/// any pending question and the session list (agent-protocol.md, Flutter
/// implementation). One turn runs at a time; a message sent while one runs
/// interrupts it. Events are ordered by `seq`.
final class ChatControllerProvider
    extends $NotifierProvider<ChatController, ChatState> {
  /// Conversation state: the open session, its turns, the turn in progress,
  /// any pending question and the session list (agent-protocol.md, Flutter
  /// implementation). One turn runs at a time; a message sent while one runs
  /// interrupts it. Events are ordered by `seq`.
  ChatControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'chatControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$chatControllerHash();

  @$internal
  @override
  ChatController create() => ChatController();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(ChatState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<ChatState>(value),
    );
  }
}

String _$chatControllerHash() => r'af84ff1f57b2ab3aad905c3af3d6128c51e785ce';

/// Conversation state: the open session, its turns, the turn in progress,
/// any pending question and the session list (agent-protocol.md, Flutter
/// implementation). One turn runs at a time; a message sent while one runs
/// interrupts it. Events are ordered by `seq`.

abstract class _$ChatController extends $Notifier<ChatState> {
  ChatState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<ChatState, ChatState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<ChatState, ChatState>,
              ChatState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
