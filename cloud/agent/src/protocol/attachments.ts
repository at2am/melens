import { AgentServiceError, type AttachmentInput, type AttachmentRef, type ImageMimeType } from './schemas.js';
import { newId } from '../sessions/store.js';

/** A photo of a turn, decoded and checked: what Gemini reads and what the store keeps. */
export interface TurnImage {
  readonly id: string;
  readonly mimeType: ImageMimeType;
  readonly data: Buffer;
}

/** The first bytes each accepted type starts with; HEIC and HEIF are ISO media files with `ftyp` at offset 4. */
function matchesType(data: Buffer, mimeType: ImageMimeType): boolean {
  switch (mimeType) {
    case 'image/jpeg': return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'image/png': return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp': return data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'image/heic':
    case 'image/heif': return data.subarray(4, 8).toString('latin1') === 'ftyp';
  }
}

/**
 * Decodes the photos of a turn request. The schema has already bounded their number and encoded size; this
 * checks the decoded size and that the bytes are the declared type, so Gemini never receives a mislabelled file.
 */
export function decodeImages(inputs: readonly AttachmentInput[], maxBytes: number): TurnImage[] {
  return inputs.map((input) => {
    const data = Buffer.from(input.data, 'base64');
    if (data.length === 0 || data.length > maxBytes || !matchesType(data, input.mimeType)) throw new AgentServiceError('invalidRequest');
    return { id: newId('a'), mimeType: input.mimeType, data };
  });
}

export function attachmentRefOf(image: TurnImage): AttachmentRef {
  return { id: image.id, kind: 'image', mimeType: image.mimeType, bytes: image.data.length };
}
