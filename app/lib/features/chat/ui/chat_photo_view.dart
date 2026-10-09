import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../../../l10n/app_localizations.dart';
import '../data/chat_photos.dart';
import '../state/chat_photo_providers.dart';

/// A square thumbnail of a chat photo: its bytes when the app has them, or
/// the stored photo loaded from the agent service. When [expandable], a tap
/// opens the photo full size.
class ChatPhotoView extends ConsumerWidget {
  const ChatPhotoView({
    required this.photo,
    required this.size,
    required this.label,
    this.expandable = false,
    super.key,
  });

  final ChatPhoto photo;
  final double size;
  final String label;
  final bool expandable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final sessionId = photo.sessionId;
    final attachmentId = photo.attachmentId;
    final AsyncValue<Uint8List> bytes = switch (photo.bytes) {
      final local? => AsyncData(local),
      null when sessionId != null && attachmentId != null => ref.watch(
        chatPhotoBytesProvider(sessionId, attachmentId),
      ),
      null => AsyncError(StateError('No photo bytes'), StackTrace.empty),
    };
    final cacheWidth = (size * MediaQuery.devicePixelRatioOf(context)).round();
    final Widget content = switch (bytes) {
      AsyncData(:final value) => Image.memory(
        value,
        width: size,
        height: size,
        fit: BoxFit.cover,
        cacheWidth: cacheWidth,
        gaplessPlayback: true,
        errorBuilder: (context, error, stack) => _unavailable(context),
      ),
      AsyncError() => _unavailable(context),
      _ => const Center(
        child: SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
    };
    final loaded = bytes.value;
    return Semantics(
      image: true,
      label: label,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Material(
          color: colors.surfaceContainerHighest,
          child: InkWell(
            onTap: expandable && loaded != null
                ? () => unawaited(_expand(context, loaded))
                : null,
            child: SizedBox(width: size, height: size, child: content),
          ),
        ),
      ),
    );
  }

  Widget _unavailable(BuildContext context) => Tooltip(
    message: AppLocalizations.of(context).chatPhotoUnavailable,
    child: Icon(
      Icons.broken_image_outlined,
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    ),
  );

  Future<void> _expand(BuildContext context, Uint8List bytes) =>
      showDialog<void>(
        context: context,
        builder: (dialogContext) => PointerInterceptor(
          child: Dialog(
            clipBehavior: Clip.antiAlias,
            child: Stack(
              children: [
                InteractiveViewer(
                  child: Image.memory(
                    bytes,
                    fit: BoxFit.contain,
                    semanticLabel: label,
                  ),
                ),
                Positioned(
                  top: 4,
                  right: 4,
                  child: IconButton.filledTonal(
                    key: const ValueKey('chat-photo-close'),
                    tooltip: MaterialLocalizations.of(dialogContext)
                        .closeButtonTooltip,
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
}
