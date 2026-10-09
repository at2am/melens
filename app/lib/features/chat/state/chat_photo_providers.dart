import 'dart:async';
import 'dart:typed_data';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../agent/state/agent_providers.dart';
import '../data/chat_photos.dart';

part 'chat_photo_providers.g.dart';

/// Tests override this with a scripted [PhotoPicker].
@Riverpod(keepAlive: true)
PhotoPicker photoPicker(Ref ref) => DevicePhotoPicker();

/// The bytes of a stored photo, for a restored turn. They stay cached for a
/// few minutes after the last view stops showing them, so scrolling back and
/// forth does not download them again.
@riverpod
Future<Uint8List> chatPhotoBytes(
  Ref ref,
  String sessionId,
  String attachmentId,
) async {
  final bytes = await ref
      .read(agentClientProvider)
      .getAttachment(sessionId, attachmentId);
  final link = ref.keepAlive();
  Timer? release;
  ref
    ..onCancel(() => release = Timer(const Duration(minutes: 5), link.close))
    ..onResume(() => release?.cancel())
    ..onDispose(() => release?.cancel());
  return bytes;
}
