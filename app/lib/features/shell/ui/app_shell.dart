import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../../../app/router.dart';
import '../../../core/network/public_source_opener.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../cards/ui/card_registry.dart';
import '../../chat/ui/chat_panel.dart';
import '../../map/state/map_actions.dart';
import '../state/shell_providers.dart';

/// Width from which the chat docks beside the page instead of opening as a
/// sheet over it.
const _dockedChatWidth = 1050.0;

/// The frame around the three tabs: the bottom navigation and the floating
/// button that opens the agent chat. The chat belongs to the frame, not to a
/// tab, so it opens from anywhere and keeps its conversation across tabs.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  bool _dockedChatOpen = false;

  @override
  void initState() {
    super.initState();
    // An agent that moves or highlights the map brings the map forward.
    ref.listenManual(mapActionsControllerProvider, (previous, next) {
      final focused =
          next.focus != null &&
          next.focus?.sequence != previous?.focus?.sequence;
      final highlighted =
          next.highlightedIds.isNotEmpty &&
          next.highlightedIds != previous?.highlightedIds;
      if (focused || highlighted) _showMap();
    });
  }

  void _showMap() => widget.navigationShell.goBranch(AppBranch.discover.index);

  ValueChanged<Uri>? get _sourceOpener =>
      supportsPublicSourceOpening ? openPublicSource : null;

  Widget _chat({VoidCallback? onClose, required CardItemCallback onItem}) =>
      ChatPanel(
        key: const ValueKey('app-chat-panel'),
        onClose: onClose,
        onCardItemTap: onItem,
        onOpenSource: _sourceOpener,
      );

  void _openItem(CardItem item) {
    ref.read(cardItemRequestsProvider.notifier).request(item);
    _showMap();
  }

  void _toggleChat({required bool docked}) {
    if (docked) {
      setState(() => _dockedChatOpen = !_dockedChatOpen);
    } else {
      _showChatSheet();
    }
  }

  void _showChatSheet() {
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (sheetContext) => PointerInterceptor(
          // useSafeArea keeps the sheet below the status bar only; the input
          // must also clear the home indicator.
          child: SafeArea(
            top: false,
            child: SizedBox(
              height: math.min(
                760,
                MediaQuery.sizeOf(sheetContext).height * 0.9,
              ),
              child: _chat(
                onClose: () => Navigator.of(sheetContext).pop(),
                // The sheet covers the page, so a tapped item closes it.
                onItem: (item) {
                  Navigator.of(sheetContext).pop();
                  _openItem(item);
                },
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final shell = widget.navigationShell;
    final theme = Theme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final docked = constraints.maxWidth >= _dockedChatWidth;
        final chatOpen = docked && _dockedChatOpen;
        final page = Scaffold(
          body: shell,
          floatingActionButton: PointerInterceptor(
            child: FloatingActionButton(
              key: const ValueKey('chat-fab'),
              tooltip: chatOpen ? strings.chatClose : strings.chatOpen,
              onPressed: () => _toggleChat(docked: docked),
              child: Icon(chatOpen ? Icons.close : Icons.auto_awesome),
            ),
          ),
          bottomNavigationBar: NavigationBar(
            key: const ValueKey('app-navigation'),
            selectedIndex: shell.currentIndex,
            onDestinationSelected: (index) => shell.goBranch(
              index,
              initialLocation: index == shell.currentIndex,
            ),
            destinations: [
              NavigationDestination(
                key: const ValueKey('tab-feed'),
                icon: const Icon(Icons.home_outlined),
                selectedIcon: const Icon(Icons.home),
                label: strings.tabFeed,
              ),
              NavigationDestination(
                key: const ValueKey('tab-discover'),
                icon: const Icon(Icons.explore_outlined),
                selectedIcon: const Icon(Icons.explore),
                label: strings.tabDiscover,
              ),
              NavigationDestination(
                key: const ValueKey('tab-settings'),
                icon: const Icon(Icons.tune_outlined),
                selectedIcon: const Icon(Icons.tune),
                label: strings.tabSettings,
              ),
            ],
          ),
        );
        if (!chatOpen) return page;
        return Row(
          children: [
            Expanded(child: page),
            DecoratedBox(
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(color: theme.colorScheme.outlineVariant),
                ),
              ),
              child: SizedBox(
                width: 400,
                child: Material(
                  color: theme.colorScheme.surface,
                  child: SafeArea(
                    child: _chat(
                      onClose: () => setState(() => _dockedChatOpen = false),
                      onItem: _openItem,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
