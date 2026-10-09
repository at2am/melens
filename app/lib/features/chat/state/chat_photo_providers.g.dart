// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chat_photo_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Tests override this with a scripted [PhotoPicker].

@ProviderFor(photoPicker)
final photoPickerProvider = PhotoPickerProvider._();

/// Tests override this with a scripted [PhotoPicker].

final class PhotoPickerProvider
    extends $FunctionalProvider<PhotoPicker, PhotoPicker, PhotoPicker>
    with $Provider<PhotoPicker> {
  /// Tests override this with a scripted [PhotoPicker].
  PhotoPickerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'photoPickerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$photoPickerHash();

  @$internal
  @override
  $ProviderElement<PhotoPicker> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  PhotoPicker create(Ref ref) {
    return photoPicker(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(PhotoPicker value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<PhotoPicker>(value),
    );
  }
}

String _$photoPickerHash() => r'e1b561cdb9ab7fb4e394f2f8f43b6b397590981b';

/// The bytes of a stored photo, for a restored turn. They stay cached for a
/// few minutes after the last view stops showing them, so scrolling back and
/// forth does not download them again.

@ProviderFor(chatPhotoBytes)
final chatPhotoBytesProvider = ChatPhotoBytesFamily._();

/// The bytes of a stored photo, for a restored turn. They stay cached for a
/// few minutes after the last view stops showing them, so scrolling back and
/// forth does not download them again.

final class ChatPhotoBytesProvider
    extends
        $FunctionalProvider<
          AsyncValue<Uint8List>,
          Uint8List,
          FutureOr<Uint8List>
        >
    with $FutureModifier<Uint8List>, $FutureProvider<Uint8List> {
  /// The bytes of a stored photo, for a restored turn. They stay cached for a
  /// few minutes after the last view stops showing them, so scrolling back and
  /// forth does not download them again.
  ChatPhotoBytesProvider._({
    required ChatPhotoBytesFamily super.from,
    required (String, String) super.argument,
  }) : super(
         retry: null,
         name: r'chatPhotoBytesProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$chatPhotoBytesHash();

  @override
  String toString() {
    return r'chatPhotoBytesProvider'
        ''
        '$argument';
  }

  @$internal
  @override
  $FutureProviderElement<Uint8List> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<Uint8List> create(Ref ref) {
    final argument = this.argument as (String, String);
    return chatPhotoBytes(ref, argument.$1, argument.$2);
  }

  @override
  bool operator ==(Object other) {
    return other is ChatPhotoBytesProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$chatPhotoBytesHash() => r'afb8da3dee4da693c8483b116184e51fae300d53';

/// The bytes of a stored photo, for a restored turn. They stay cached for a
/// few minutes after the last view stops showing them, so scrolling back and
/// forth does not download them again.

final class ChatPhotoBytesFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<Uint8List>, (String, String)> {
  ChatPhotoBytesFamily._()
    : super(
        retry: null,
        name: r'chatPhotoBytesProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// The bytes of a stored photo, for a restored turn. They stay cached for a
  /// few minutes after the last view stops showing them, so scrolling back and
  /// forth does not download them again.

  ChatPhotoBytesProvider call(String sessionId, String attachmentId) =>
      ChatPhotoBytesProvider._(argument: (sessionId, attachmentId), from: this);

  @override
  String toString() => r'chatPhotoBytesProvider';
}
