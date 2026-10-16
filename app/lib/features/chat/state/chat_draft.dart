import 'package:flutter/widgets.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../data/chat_photos.dart';

part 'chat_draft.g.dart';

/// Unsent input belongs to the app's chat, across panel and sheet lifetimes.
final class ChatDraft {
  final input = TextEditingController();
  final photos = <ChatPhoto>[];
  String? photoNotice;

  void dispose() => input.dispose();
}

@Riverpod(keepAlive: true)
ChatDraft chatDraft(Ref ref) {
  final draft = ChatDraft();
  ref.onDispose(draft.dispose);
  return draft;
}
