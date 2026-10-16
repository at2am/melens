import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

/// Building blocks of the selected-record panel: one headline figure, labelled
/// facts, status chips and short notes, so every layer reads the same way.

/// A labelled fact on two lines: a small label above its value.
class MapDetailFactRow extends StatelessWidget {
  const MapDetailFactRow({
    required this.label,
    required this.value,
    this.caption,
    super.key,
  });

  final String label;
  final String value;

  /// Optional explanation under the value, such as how a baseline is formed.
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: MergeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: theme.textTheme.labelMedium?.copyWith(color: muted),
            ),
            Text(value, style: theme.textTheme.bodyLarge),
            if (caption case final caption?)
              Text(
                caption,
                style: theme.textTheme.bodySmall?.copyWith(color: muted),
              ),
          ],
        ),
      ),
    );
  }
}

/// The one figure a record is about, such as a count, with what it counts.
class MapDetailHeadline extends StatelessWidget {
  const MapDetailHeadline({
    required this.value,
    this.caption,
    this.color,
    super.key,
  });

  final String value;
  final String? caption;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: MergeSemantics(
        child: Wrap(
          crossAxisAlignment: WrapCrossAlignment.end,
          spacing: 8,
          children: [
            Text(
              value,
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
            if (caption case final caption?)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text(caption, style: theme.textTheme.bodyMedium),
              ),
          ],
        ),
      ),
    );
  }
}

/// A caveat or explanation, set apart from the facts.
class MapDetailNote extends StatelessWidget {
  const MapDetailNote(this.text, {this.icon = Icons.info_outline, super.key});

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2, right: 8),
            child: ExcludeSemantics(child: Icon(icon, size: 16, color: muted)),
          ),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            ),
          ),
        ],
      ),
    );
  }
}

enum MapChipTone { positive, neutral, caution, negative }

/// A short status such as "Approved" or "Tickets on sale".
class MapStatusChip extends StatelessWidget {
  const MapStatusChip({
    required this.label,
    this.tone = MapChipTone.neutral,
    super.key,
  });

  final String label;
  final MapChipTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (background, foreground) = switch (tone) {
      MapChipTone.positive => (
        colors.primaryContainer,
        colors.onPrimaryContainer,
      ),
      MapChipTone.neutral => (
        colors.surfaceContainerHighest,
        colors.onSurfaceVariant,
      ),
      MapChipTone.caution => (
        colors.tertiaryContainer,
        colors.onTertiaryContainer,
      ),
      MapChipTone.negative => (colors.errorContainer, colors.onErrorContainer),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelMedium
            ?.copyWith(color: foreground),
      ),
    );
  }
}

/// Every supplied digit, with thousands grouped: 1361.57 → "1,361.57",
/// 6.0 → "6". Source measurements are shown exactly, never rounded.
String formatExactNumber(num value) {
  if (!value.isFinite) return value.toString();
  final grouped = NumberFormat.decimalPattern('en_AU');
  if (value == value.truncate()) return grouped.format(value.truncate());
  final text = value.abs().toString();
  final point = text.indexOf('.');
  if (point < 0 || text.contains('e')) return value.toString();
  final whole = grouped.format(int.parse(text.substring(0, point)));
  return '${value < 0 ? '-' : ''}$whole${text.substring(point)}';
}
