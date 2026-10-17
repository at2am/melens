import 'package:flutter/gestures.dart';
import 'package:material_ui/material_ui.dart';

/// Whether [text] uses any of the Markdown [ChatMarkdown] renders; plain
/// text keeps a plain [SelectableText].
bool hasChatMarkdown(String text) => _markdownSyntax.hasMatch(text);

final _markdownSyntax = RegExp(
  r'(\*\*|__|`|\[[^\]\n]+\]\([^)\s]+\)|(^|\n)\s*([-*•]|\d{1,2}[.)])\s|(^|\n)#{1,6}\s)',
);
final _bullet = RegExp(r'^\s*[-*•]\s+(.*)$');
final _numbered = RegExp(r'^\s*(\d{1,2})[.)]\s+(.*)$');
final _heading = RegExp(r'^#{1,6}\s+(.*)$');
final _inline = RegExp(
  r'\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])',
);

sealed class _Block {
  const _Block(this.text);
  final String text;
}

final class _Paragraph extends _Block {
  const _Paragraph(super.text);
}

final class _Heading extends _Block {
  const _Heading(super.text);
}

final class _Item extends _Block {
  const _Item(super.text, this.marker);

  /// `•` for a bullet, `3.` for a numbered item.
  final String marker;
}

List<_Block> _blocks(String text) {
  final blocks = <_Block>[];
  final paragraph = <String>[];
  void flush() {
    if (paragraph.isEmpty) return;
    blocks.add(_Paragraph(paragraph.join('\n')));
    paragraph.clear();
  }

  for (final line in text.split('\n')) {
    if (line.trim().isEmpty) {
      flush();
    } else if (_heading.firstMatch(line) case final match?) {
      flush();
      blocks.add(_Heading(match[1]!));
    } else if (_bullet.firstMatch(line) case final match?) {
      flush();
      blocks.add(_Item(match[1]!, '•'));
    } else if (_numbered.firstMatch(line) case final match?) {
      flush();
      blocks.add(_Item(match[2]!, '${match[1]}.'));
    } else {
      paragraph.add(line);
    }
  }
  flush();
  return blocks;
}

/// The simple Markdown the agent writes in its answers: paragraphs, `-` and
/// numbered lists, headings, bold, italics, inline code and links. Each block
/// is selectable; a link opens through [onOpenLink].
class ChatMarkdown extends StatefulWidget {
  const ChatMarkdown(this.text, {this.onOpenLink, super.key});

  final String text;
  final ValueChanged<Uri>? onOpenLink;

  @override
  State<ChatMarkdown> createState() => _ChatMarkdownState();
}

class _ChatMarkdownState extends State<ChatMarkdown> {
  final _recognizers = <TapGestureRecognizer>[];

  void _disposeRecognizers() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    _recognizers.clear();
  }

  @override
  void dispose() {
    _disposeRecognizers();
    super.dispose();
  }

  List<InlineSpan> _spans(String text, TextStyle base, ColorScheme colors) {
    final spans = <InlineSpan>[];
    var cursor = 0;
    for (final match in _inline.allMatches(text)) {
      if (match.start > cursor) {
        spans.add(TextSpan(text: text.substring(cursor, match.start)));
      }
      cursor = match.end;
      if (match[1] ?? match[2] case final bold?) {
        spans.add(
          TextSpan(
            children: _spans(bold, base, colors),
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        );
      } else if (match[3] case final code?) {
        spans.add(
          TextSpan(
            text: code,
            style: TextStyle(
              fontFamily: 'monospace',
              backgroundColor: colors.surfaceContainerHighest,
            ),
          ),
        );
      } else if (match[4] case final label?) {
        final uri = Uri.tryParse(match[5]!);
        final opens =
            uri != null &&
            (uri.scheme == 'https' || uri.scheme == 'http') &&
            widget.onOpenLink != null;
        TapGestureRecognizer? recognizer;
        if (opens) {
          recognizer = TapGestureRecognizer()
            ..onTap = () => widget.onOpenLink!(uri);
          _recognizers.add(recognizer);
        }
        spans.add(
          TextSpan(
            text: label,
            recognizer: recognizer,
            style: TextStyle(
              color: colors.primary,
              decoration: opens ? TextDecoration.underline : null,
            ),
          ),
        );
      } else if (match[6] case final italic?) {
        spans.add(
          TextSpan(
            text: italic,
            style: const TextStyle(fontStyle: FontStyle.italic),
          ),
        );
      }
    }
    if (cursor < text.length) spans.add(TextSpan(text: text.substring(cursor)));
    return spans;
  }

  @override
  Widget build(BuildContext context) {
    _disposeRecognizers();
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final base = theme.textTheme.bodyMedium ?? const TextStyle();
    final blocks = _blocks(widget.text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (index, block) in blocks.indexed)
          Padding(
            padding: EdgeInsets.only(
              top: index == 0 ? 0 : (block is _Item ? 2 : 6),
            ),
            child: switch (block) {
              _Heading(:final text) => SelectableText.rich(
                TextSpan(children: _spans(text, base, colors)),
                style: theme.textTheme.titleSmall,
              ),
              _Item(:final text, :final marker) => Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: marker == '•' ? 16 : 24,
                    child: Text(marker, style: base),
                  ),
                  Expanded(
                    child: SelectableText.rich(
                      TextSpan(children: _spans(text, base, colors)),
                      style: base,
                    ),
                  ),
                ],
              ),
              _Paragraph(:final text) => SelectableText.rich(
                TextSpan(children: _spans(text, base, colors)),
                style: base,
              ),
            },
          ),
      ],
    );
  }
}
