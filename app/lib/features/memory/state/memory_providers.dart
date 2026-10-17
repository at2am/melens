import 'dart:async';

import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/network/http_client.dart';
import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../agent/state/agent_providers.dart';
import '../../map/data/map_models.dart';
import '../data/memory_client.dart';
import '../data/memory_models.dart';

part 'memory_providers.g.dart';

// A pull to refresh reissues the request; failures never loop.
Duration? _manualRetry(int retryCount, Object error) => null;

/// Tests override this with a scripted [MemoryClient].
@Riverpod(keepAlive: true)
MemoryClient memoryClient(Ref ref) => HttpMemoryClient(
  client: ref.watch(httpClientProvider),
  baseUrl: ref.watch(envProvider).agentBaseUrl,
  tokenSource: ref.watch(agentTokenSourceProvider),
);

/// What the assistant remembers about the user, as the agent service keeps
/// it. Settings shows it; the user switches it off, forgets one fact or
/// clears it all.
@Riverpod(keepAlive: true, retry: _manualRetry)
class AssistantMemory extends _$AssistantMemory {
  @override
  Future<UserMemory> build() async {
    // Browsing not yet sent belongs in what the user is about to see.
    await ref.read(browsingTrackerProvider.notifier).flush();
    return ref.read(memoryClientProvider).load();
  }

  /// Switches memory on or off. Throws the [AgentClientException] family
  /// for the caller to report.
  Future<void> setEnabled({required bool enabled}) async {
    final memory = await ref
        .read(memoryClientProvider)
        .setEnabled(enabled: enabled);
    if (ref.mounted) state = AsyncData(memory);
  }

  /// Removes the fact at once and then on the service; a failure puts it
  /// back and rethrows. A fact the service no longer has stays removed.
  Future<void> forget(String factId) async {
    final previous = state.value;
    if (previous == null) return;
    state = AsyncData(
      previous.copyWith(
        facts: [
          for (final fact in previous.facts)
            if (fact.id != factId) fact,
        ],
      ),
    );
    try {
      await ref.read(memoryClientProvider).forget(factId);
    } on AgentHttpException catch (error) {
      if (error.code == AgentErrorCode.notFound) return;
      if (ref.mounted) state = AsyncData(previous);
      rethrow;
    } on Object {
      if (ref.mounted) state = AsyncData(previous);
      rethrow;
    }
  }

  /// Forgets everything; the on or off setting stays. Throws the
  /// [AgentClientException] family for the caller to report.
  Future<void> clear() async {
    await ref.read(memoryClientProvider).clear();
    if (!ref.mounted) return;
    final enabled = state.value?.enabled ?? true;
    state = AsyncData(UserMemory(enabled: enabled));
  }
}

/// Signals sent together once this many are waiting.
const browsingBatchSize = 10;

/// What the user does on the map, kept for the assistant's memory: the layers
/// they turn on and the records they open, never where. Signals wait here and
/// go to the agent service in batches, and before each chat message, so the
/// assistant reads them with the message. While memory is off nothing is
/// kept. A batch that fails is dropped: browsing is a hint, not a record.
@Riverpod(keepAlive: true)
class BrowsingTracker extends _$BrowsingTracker {
  static final _log = Logger('BrowsingTracker');

  Future<void>? _sending;

  /// The signals waiting to be sent.
  @override
  List<BrowsingSignal> build() => const [];

  /// The user turned [layer] on: a map layer id or `community`.
  void layerShown(String layer) =>
      _add(BrowsingSignal(kind: BrowsingAction.show, layer: layer));

  /// The user opened [item] on the map.
  void opened(MapItem item) => _add(
    BrowsingSignal(
      kind: BrowsingAction.open,
      layer: item.layerId.name,
      category: switch (item.details) {
        EventDetails(:final category?) when category.trim().isNotEmpty =>
          category.trim(),
        _ => null,
      },
    ),
  );

  void _add(BrowsingSignal signal) {
    final memory = ref.exists(assistantMemoryProvider)
        ? ref.read(assistantMemoryProvider).value
        : null;
    if (memory?.enabled == false) return;
    state = [...state, signal];
    if (state.length >= browsingBatchSize) unawaited(flush());
  }

  /// Sends what is waiting; resolves when it is sent or dropped, never
  /// throws.
  Future<void> flush() async {
    await _sending;
    if (state.isEmpty) return;
    final batch = state;
    state = const [];
    final sending = ref.read(memoryClientProvider).report(batch).catchError((
      Object error,
    ) {
      _log.fine('Browsing signals were dropped', error);
    });
    _sending = sending;
    await sending;
    if (identical(_sending, sending)) _sending = null;
  }
}
