import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:image_picker/image_picker.dart';
import 'package:logging/logging.dart';

import '../../agent/data/agent_models.dart';

/// A photo of a chat turn: the bytes this app run picked or loaded, or, for
/// a restored turn, where the server stored it.
final class ChatPhoto {
  const ChatPhoto({
    required this.mimeType,
    this.bytes,
    this.sessionId,
    this.attachmentId,
  });

  final String mimeType;
  final Uint8List? bytes;

  /// Set together for a photo the server stored.
  final String? sessionId;
  final String? attachmentId;
}

enum PhotoSource { gallery, camera }

/// What a pick returned: the photos ready to send, and how many were left
/// out because they could not be read or stayed too large.
typedef PhotoPick = ({List<ChatPhoto> photos, int rejected});

/// Picks photos for a chat turn and prepares them for the agent service.
abstract interface class PhotoPicker {
  /// At most [limit] photos; an empty pick when the user cancels.
  Future<PhotoPick> pick(PhotoSource source, {required int limit});
}

/// The device's gallery and camera through `image_picker`, which also
/// downsizes on every platform before the bytes reach the app.
final class DevicePhotoPicker implements PhotoPicker {
  DevicePhotoPicker([ImagePicker? picker]) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  static const double _maxEdge = 1600;
  static const int _quality = 80;

  @override
  Future<PhotoPick> pick(PhotoSource source, {required int limit}) async {
    if (limit <= 0) return (photos: const <ChatPhoto>[], rejected: 0);
    final List<XFile> files = switch (source) {
      PhotoSource.gallery when limit > 1 => await _picker.pickMultiImage(
        maxWidth: _maxEdge,
        maxHeight: _maxEdge,
        imageQuality: _quality,
        limit: limit,
      ),
      _ => [
        ?await _picker.pickImage(
          source: source == PhotoSource.camera
              ? ImageSource.camera
              : ImageSource.gallery,
          maxWidth: _maxEdge,
          maxHeight: _maxEdge,
          imageQuality: _quality,
        ),
      ],
    };
    final photos = <ChatPhoto>[];
    var rejected = 0;
    for (final file in files.take(limit)) {
      final photo = await preparePhoto(await file.readAsBytes());
      if (photo == null) {
        rejected++;
      } else {
        photos.add(photo);
      }
    }
    final extra = files.length > limit ? files.length - limit : 0;
    return (photos: photos, rejected: rejected + extra);
  }
}

final _log = Logger('ChatPhotos');

/// The photo type the bytes start with, when the service accepts it.
String? sniffPhotoType(Uint8List bytes) {
  bool startsWith(List<int> prefix, [int offset = 0]) {
    if (bytes.length < offset + prefix.length) return false;
    for (var i = 0; i < prefix.length; i++) {
      if (bytes[offset + i] != prefix[i]) return false;
    }
    return true;
  }

  if (startsWith(const [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith('RIFF'.codeUnits) && startsWith('WEBP'.codeUnits, 8)) {
    return 'image/webp';
  }
  if (startsWith('ftyp'.codeUnits, 4) && bytes.length >= 12) {
    final brand = String.fromCharCodes(bytes.sublist(8, 12));
    if (const {'heic', 'heix', 'hevc', 'hevx'}.contains(brand)) {
      return 'image/heic';
    }
    if (const {'mif1', 'msf1', 'heif'}.contains(brand)) return 'image/heif';
  }
  return null;
}

/// Makes picked bytes sendable. An accepted type within [maxBytes] is sent
/// as it is; anything else is decoded and re-encoded as PNG at a shrinking
/// size until it fits. Null when the bytes cannot be decoded or never fit.
Future<ChatPhoto?> preparePhoto(
  Uint8List bytes, {
  int maxBytes = maxPhotoBytes,
}) async {
  final type = sniffPhotoType(bytes);
  if (type != null && bytes.length <= maxBytes) {
    return ChatPhoto(mimeType: type, bytes: bytes);
  }
  for (final edge in const [1280, 960, 640]) {
    final png = await _shrinkToPng(bytes, edge);
    if (png == null) return null;
    if (png.length <= maxBytes) {
      return ChatPhoto(mimeType: 'image/png', bytes: png);
    }
  }
  return null;
}

Future<Uint8List?> _shrinkToPng(Uint8List bytes, int maxEdge) async {
  ui.Codec? codec;
  ui.Image? image;
  try {
    // The codec takes the buffer over and disposes it.
    final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
    codec = await ui.instantiateImageCodecWithSize(
      buffer,
      getTargetSize: (width, height) => width >= height
          ? ui.TargetImageSize(width: math.min(width, maxEdge))
          : ui.TargetImageSize(height: math.min(height, maxEdge)),
    );
    image = (await codec.getNextFrame()).image;
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
  } on Object catch (error) {
    _log.fine('A picked photo could not be decoded', error);
    return null;
  } finally {
    image?.dispose();
    codec?.dispose();
  }
}
