import 'package:melens/features/memory/data/memory_client.dart';
import 'package:melens/features/memory/data/memory_models.dart';

/// The agent service's memory of one user. [failure] makes the next calls
/// throw; [reported] holds every batch of browsing signals sent.
final class FakeMemoryClient implements MemoryClient {
  FakeMemoryClient({UserMemory? memory})
    : memory = memory ?? const UserMemory(enabled: true);

  UserMemory memory;
  Object? failure;
  final reported = <List<BrowsingSignal>>[];
  final calls = <String>[];

  @override
  Future<UserMemory> load() async {
    calls.add('load');
    if (failure case final error?) throw error;
    return memory;
  }

  @override
  Future<UserMemory> setEnabled({required bool enabled}) async {
    calls.add('setEnabled:$enabled');
    if (failure case final error?) throw error;
    return memory = memory.copyWith(enabled: enabled);
  }

  @override
  Future<void> clear() async {
    calls.add('clear');
    if (failure case final error?) throw error;
    memory = UserMemory(enabled: memory.enabled);
  }

  @override
  Future<void> forget(String factId) async {
    calls.add('forget:$factId');
    if (failure case final error?) throw error;
    memory = memory.copyWith(
      facts: [
        for (final fact in memory.facts)
          if (fact.id != factId) fact,
      ],
    );
  }

  @override
  Future<void> report(List<BrowsingSignal> signals) async {
    calls.add('report:${signals.length}');
    if (failure case final error?) throw error;
    reported.add(signals);
  }
}
