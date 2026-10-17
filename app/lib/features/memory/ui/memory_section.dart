import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../map/data/map_models.dart';
import '../../map/ui/layer_panel.dart';
import '../data/memory_models.dart';
import '../state/memory_providers.dart';

IconData _kindIcon(MemoryKind kind) => switch (kind) {
  MemoryKind.travel => Icons.commute,
  MemoryKind.interest => Icons.favorite_border,
  MemoryKind.routine => Icons.schedule,
  MemoryKind.preference => Icons.tune,
  MemoryKind.other => Icons.notes,
};

/// A browsed layer by its title: a map layer, or the community events switch.
String browsedLayerTitle(AppLocalizations strings, String layer) =>
    switch (MapLayerId.values.where((id) => id.name == layer).firstOrNull) {
      final id? => layerTitle(strings, id),
      null when layer == 'community' => strings.mapCommunityLayer,
      null => layer,
    };

/// What the assistant remembers about the user: the switch, each fact with
/// its own forget button, what they browse most and Forget everything.
class MemorySection extends ConsumerWidget {
  const MemorySection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final memory = ref.watch(assistantMemoryProvider);
    final value = memory.value;
    if (value == null) {
      return memory.hasError
          ? ListTile(
              key: const ValueKey('settings-memory-error'),
              leading: const Icon(Icons.cloud_off),
              title: Text(strings.settingsMemoryError),
              trailing: TextButton(
                onPressed: () => ref.invalidate(assistantMemoryProvider),
                child: Text(strings.feedRetry),
              ),
            )
          : const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            );
    }
    final controller = ref.read(assistantMemoryProvider.notifier);

    Future<void> attempt(Future<void> Function() change) async {
      final messenger = ScaffoldMessenger.of(context);
      try {
        await change();
      } on Object {
        messenger.showSnackBar(
          SnackBar(content: Text(strings.settingsMemorySaveFailed)),
        );
      }
    }

    Future<void> clear() async {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(strings.settingsMemoryClearTitle),
          content: Text(strings.settingsMemoryClearBody),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(strings.settingsCancel),
            ),
            FilledButton(
              key: const ValueKey('settings-memory-clear-confirm'),
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(strings.settingsMemoryClearConfirm),
            ),
          ],
        ),
      );
      if (confirmed ?? false) await attempt(controller.clear);
    }

    final browsing = value.browsing;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SwitchListTile(
          key: const ValueKey('settings-memory'),
          secondary: const Icon(Icons.psychology_outlined),
          title: Text(strings.settingsMemorySwitch),
          subtitle: Text(
            value.enabled
                ? strings.settingsMemoryOn
                : strings.settingsMemoryOff,
          ),
          value: value.enabled,
          onChanged: (enabled) =>
              unawaited(attempt(() => controller.setEnabled(enabled: enabled))),
        ),
        if (value.isEmpty)
          ListTile(
            key: const ValueKey('settings-memory-empty'),
            leading: const Icon(Icons.info_outline),
            title: Text(strings.settingsMemoryEmpty),
          ),
        for (final fact in value.facts)
          ListTile(
            key: ValueKey('settings-memory-fact-${fact.id}'),
            leading: Icon(_kindIcon(fact.kind)),
            title: Text(fact.text),
            trailing: IconButton(
              key: ValueKey('settings-memory-forget-${fact.id}'),
              tooltip: strings.settingsMemoryForget,
              icon: const Icon(Icons.close),
              onPressed: () =>
                  unawaited(attempt(() => controller.forget(fact.id))),
            ),
          ),
        if (!browsing.isEmpty)
          ListTile(
            key: const ValueKey('settings-memory-browsing'),
            leading: const Icon(Icons.insights),
            title: Text(strings.settingsMemoryBrowses),
            subtitle: Text(
              [
                for (final layer in browsing.layers)
                  browsedLayerTitle(strings, layer.layer),
                ...browsing.categories,
              ].join(' · '),
            ),
          ),
        if (!value.isEmpty)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              key: const ValueKey('settings-memory-clear'),
              onPressed: () => unawaited(clear()),
              icon: const Icon(Icons.delete_outline),
              label: Text(strings.settingsMemoryClear),
            ),
          ),
      ],
    );
  }
}
