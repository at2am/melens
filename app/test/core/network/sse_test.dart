import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/network/sse.dart';

/// Decodes [chunks] as if they arrived from the network one by one.
Future<List<SseEvent>> decode(List<List<int>> chunks) =>
    Stream.fromIterable(chunks).transform(const SseDecoder()).toList();

Future<List<SseEvent>> decodeText(String body) => decode([utf8.encode(body)]);

void main() {
  test('reads event names and data', () async {
    final events = await decodeText(
      'event: status\ndata: {"text":"Searching the map"}\n\n'
      'data: plain\n\n',
    );

    expect(events, [
      const SseEvent(event: 'status', data: '{"text":"Searching the map"}'),
      const SseEvent(data: 'plain'),
    ]);
  });

  test('joins multi-line data with newlines', () async {
    final events = await decodeText('data: one\ndata: two\ndata:\n\n');

    expect(events.single.data, 'one\ntwo\n');
  });

  test('ignores comments, retry hints and unknown fields', () async {
    final events = await decodeText(
      ': keep-alive\nretry: 1000\nfoo: bar\ndata: x\n\n',
    );

    expect(events, [const SseEvent(data: 'x')]);
  });

  test('keeps the last id across events', () async {
    final events = await decodeText(
      'id: 7\ndata: a\n\ndata: b\n\nid: 8\ndata: c\n\n',
    );

    expect(events.map((e) => e.id), ['7', '7', '8']);
  });

  test('accepts CRLF and CR line endings and a leading BOM', () async {
    final events = await decodeText(
      '﻿event: text\r\ndata: a\r\n\r\ndata: b\r\r',
    );

    expect(events, [
      const SseEvent(event: 'text', data: 'a'),
      const SseEvent(data: 'b'),
    ]);
  });

  test('reassembles lines and characters split across chunks', () async {
    final bytes = utf8.encode('event: text\ndata: Café ☕\n\n');
    // Split inside "event", then inside the three bytes of "☕".
    final split = bytes.length - 4;
    final events = await decode([
      bytes.sublist(0, 3),
      bytes.sublist(3, split),
      bytes.sublist(split),
    ]);

    expect(events, [const SseEvent(event: 'text', data: 'Café ☕')]);
  });

  test('drops an event with no closing blank line', () async {
    final events = await decodeText('data: done\n\ndata: cut off\n');

    expect(events, [const SseEvent(data: 'done')]);
  });

  test('sends nothing for an event without data', () async {
    final events = await decodeText('event: ping\n\n');

    expect(events, isEmpty);
  });
}
