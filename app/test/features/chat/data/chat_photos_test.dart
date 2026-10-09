import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/chat/data/chat_photos.dart';

Uint8List bytesOf(List<int> head) =>
    Uint8List.fromList([...head, ...List.filled(16, 0)]);

Future<ui.Image> decode(Uint8List bytes) async {
  final codec = await ui.instantiateImageCodec(bytes);
  return (await codec.getNextFrame()).image;
}

/// A PNG of random pixels, which compresses badly.
Future<Uint8List> noisePng(int width, int height) async {
  final random = Random(7);
  final pixels = Uint8List.fromList(
    List.generate(
      width * height * 4,
      (i) => i % 4 == 3 ? 255 : random.nextInt(256),
    ),
  );
  final buffer = await ui.ImmutableBuffer.fromUint8List(pixels);
  final descriptor = ui.ImageDescriptor.raw(
    buffer,
    width: width,
    height: height,
    pixelFormat: ui.PixelFormat.rgba8888,
  );
  final image =
      (await (await descriptor.instantiateCodec()).getNextFrame()).image;
  final png = await image.toByteData(format: ui.ImageByteFormat.png);
  return png!.buffer.asUint8List();
}

void main() {
  test('the type comes from the bytes, not the file name', () {
    expect(sniffPhotoType(bytesOf([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    expect(
      sniffPhotoType(bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      'image/png',
    );
    expect(
      sniffPhotoType(
        bytesOf([...'RIFF'.codeUnits, 0, 0, 0, 0, ...'WEBP'.codeUnits]),
      ),
      'image/webp',
    );
    expect(
      sniffPhotoType(bytesOf([0, 0, 0, 24, ...'ftypheic'.codeUnits])),
      'image/heic',
    );
    expect(
      sniffPhotoType(bytesOf([0, 0, 0, 24, ...'ftypmif1'.codeUnits])),
      'image/heif',
    );
    expect(
      sniffPhotoType(bytesOf([0, 0, 0, 24, ...'ftypavif'.codeUnits])),
      isNull,
      reason: 'AVIF is not a type the service accepts',
    );
    expect(sniffPhotoType(bytesOf('GIF89a'.codeUnits)), isNull);
    expect(sniffPhotoType(Uint8List(2)), isNull);
  });

  test('an accepted photo within the limit is sent as it is', () async {
    final png = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA'
      '60e6kgAAAABJRU5ErkJggg==',
    );
    final photo = await preparePhoto(png);
    expect(photo?.mimeType, 'image/png');
    expect(photo?.bytes, same(png));
  });

  test(
    'another type becomes a PNG, and unreadable bytes are rejected',
    () async {
      final gif = base64Decode(
        'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
      );
      final photo = await preparePhoto(gif);
      expect(photo?.mimeType, 'image/png');
      expect(sniffPhotoType(photo!.bytes!), 'image/png');
      expect(
        await preparePhoto(Uint8List.fromList(List.filled(64, 7))),
        isNull,
      );
    },
  );

  test(
    'a photo over the limit shrinks until it fits, or is rejected',
    () async {
      final large = await noisePng(1400, 900);
      final limit = large.length ~/ 3;
      final photo = await preparePhoto(large, maxBytes: limit);
      expect(photo?.mimeType, 'image/png');
      expect(photo!.bytes!.length, lessThanOrEqualTo(limit));
      final image = await decode(photo.bytes!);
      expect(max(image.width, image.height), lessThan(1400));
      expect(image.width / image.height, closeTo(1400 / 900, 0.01));
      expect(await preparePhoto(large, maxBytes: 1000), isNull);
    },
  );
}
