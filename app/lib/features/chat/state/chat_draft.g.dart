// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chat_draft.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(chatDraft)
final chatDraftProvider = ChatDraftProvider._();

final class ChatDraftProvider
    extends $FunctionalProvider<ChatDraft, ChatDraft, ChatDraft>
    with $Provider<ChatDraft> {
  ChatDraftProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'chatDraftProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$chatDraftHash();

  @$internal
  @override
  $ProviderElement<ChatDraft> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  ChatDraft create(Ref ref) {
    return chatDraft(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(ChatDraft value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<ChatDraft>(value),
    );
  }
}

String _$chatDraftHash() => r'956ca91a99f801ae47b8051e9ce74d529778c2e9';
