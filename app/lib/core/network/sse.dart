import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

/// One server-sent event.
@immutable
final class SseEvent {
  const SseEvent({required this.data, this.event = 'message', this.id});

  /// The `event:` field; `message` when the server sent none.
  final String event;

  /// The `data:` lines, joined with `\n`.
  final String data;

  /// The last `id:` the stream sent, if any.
  final String? id;

  @override
  bool operator ==(Object other) =>
      other is SseEvent &&
      other.event == event &&
      other.data == data &&
      other.id == id;

  @override
  int get hashCode => Object.hash(event, data, id);

  @override
  String toString() => 'SseEvent($event, $data, id: $id)';
}

/// Decodes a `text/event-stream` body into [SseEvent]s.
///
/// Follows the WHATWG event-stream format. The browser's `EventSource` cannot
/// be used because it only sends GET requests without headers
/// (agent-protocol.md, Flutter implementation). `retry:` hints are ignored:
/// the app does not reconnect to a turn. Cancelling the returned stream
/// cancels the response body.
///
/// ```dart
/// final response = await client.send(request);
/// await for (final event in response.stream.transform(const SseDecoder())) {
///   ...
/// }
/// ```
final class SseDecoder extends StreamTransformerBase<List<int>, SseEvent> {
  const SseDecoder();

  @override
  Stream<SseEvent> bind(Stream<List<int>> stream) async* {
    var eventType = '';
    final data = StringBuffer();
    var hasData = false;
    String? lastId;
    var isFirstLine = true;

    final lines = stream
        .transform(utf8.decoder)
        .transform(const LineSplitter());
    await for (var line in lines) {
      if (isFirstLine) {
        isFirstLine = false;
        if (line.startsWith('﻿')) line = line.substring(1);
      }

      if (line.isEmpty) {
        if (hasData) {
          yield SseEvent(
            event: eventType.isEmpty ? 'message' : eventType,
            data: data.toString(),
            id: lastId,
          );
        }
        eventType = '';
        data.clear();
        hasData = false;
        continue;
      }
      if (line.startsWith(':')) continue;

      final colon = line.indexOf(':');
      final field = colon == -1 ? line : line.substring(0, colon);
      var value = colon == -1 ? '' : line.substring(colon + 1);
      if (value.startsWith(' ')) value = value.substring(1);

      switch (field) {
        case 'event':
          eventType = value;
        case 'data':
          if (hasData) data.write('\n');
          data.write(value);
          hasData = true;
        case 'id' when !value.contains('\u0000'):
          lastId = value;
      }
    }
    // An event without its closing blank line is incomplete and is dropped.
  }
}
