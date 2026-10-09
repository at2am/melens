import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../state/chat_controller.dart';

/// The user's sessions: switch, start a new one or delete one (UC-13).
class SessionList extends ConsumerWidget {
  const SessionList({this.onSelected, super.key});

  /// Called after a session was opened or created, for example to close a
  /// sheet.
  final VoidCallback? onSelected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final chat = ref.watch(chatControllerProvider);
    final controller = ref.read(chatControllerProvider.notifier);
    final clock = ref.watch(melbourneClockProvider);
    String updated(String iso) {
      final parsed = DateTime.tryParse(iso);
      if (parsed == null) return iso;
      final local = clock.toMelbourne(parsed);
      return '${DateFormat.MMMd('en_AU').format(local)} '
          '${DateFormat.Hm('en_AU').format(local)}';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  strings.chatSessions,
                  style: theme.textTheme.titleMedium,
                ),
              ),
              TextButton.icon(
                key: const ValueKey('chat-session-new'),
                onPressed: () {
                  unawaited(controller.newSession());
                  onSelected?.call();
                },
                icon: const Icon(Icons.add),
                label: Text(strings.chatNewSession),
              ),
            ],
          ),
        ),
        if (chat.sessionsLoading) const LinearProgressIndicator(),
        Expanded(
          child: chat.sessions.isEmpty
              ? Center(
                  child: Text(
                    chat.sessionsLoading
                        ? strings.chatSessionsLoading
                        : strings.chatNoSessions,
                  ),
                )
              : ListView.builder(
                  itemCount: chat.sessions.length,
                  itemBuilder: (context, index) {
                    final session = chat.sessions[index];
                    return ListTile(
                      key: ValueKey('chat-session-${session.id}'),
                      title: Text(
                        session.title.isEmpty
                            ? strings.chatSessionUntitled
                            : session.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        strings.chatSessionMeta(
                          session.turnCount,
                          updated(session.updatedAt),
                        ),
                      ),
                      selected: session.id == chat.sessionId,
                      onTap: () {
                        if (session.id != chat.sessionId) {
                          unawaited(controller.openSession(session.id));
                        }
                        onSelected?.call();
                      },
                      trailing: IconButton(
                        key: ValueKey('chat-session-delete-${session.id}'),
                        tooltip: strings.chatDeleteSession,
                        onPressed: () =>
                            unawaited(controller.deleteSession(session.id)),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// Opens the session list as a sheet above the map.
Future<void> showSessionListSheet(BuildContext context) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => PointerInterceptor(
        child: SafeArea(
          child: SizedBox(
            height: math.min(520, MediaQuery.sizeOf(sheetContext).height * 0.7),
            child: SessionList(
              onSelected: () => Navigator.of(sheetContext).pop(),
            ),
          ),
        ),
      ),
    );
