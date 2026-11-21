import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ReadZipOptions {
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function isSafeZipEntryName(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  if (normalized.includes("\0")) return false;
  const parts = normalized.split("/");
  return !parts.some((p) => p === "..");
}

/**
 * Pure-TypeScript zero-dependency ZIP archive reader supporting stored (0) and
 * deflate (8) entries with zip-slip path validation and zip-bomb size guards.
 */
export function readZipBuffer(buf: Buffer, opts: ReadZipOptions = {}): Map<string, Buffer> {
  const maxEntries = opts.maxEntries ?? 4_000;
  const maxEntryBytes = opts.maxEntryBytes ?? 16 * 1024 * 1024;
  const maxTotalBytes = opts.maxTotalBytes ?? 64 * 1024 * 1024;

  // Locate End of Central Directory (EOCD) signature 0x06054b50 from the end
  const minSearch = Math.max(0, buf.length - 65_557);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= minSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: End of Central Directory record not found");
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  if (totalEntries > maxEntries) {
    throw new Error(`ZIP archive exceeds entry limit (${totalEntries} > ${maxEntries})`);
  }
  if (cdOffset + cdSize > buf.length) {
    throw new Error("Invalid ZIP archive: Central Directory out of bounds");
  }

  const entries = new Map<string, Buffer>();
  let cursor = cdOffset;
  let totalDecompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Invalid ZIP archive: corrupt Central Directory entry");
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cursor + 42);

    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;

    if (!isSafeZipEntryName(name)) {
      throw new Error(`Refusing unsafe ZIP entry path: "${name}"`);
    }
    if (name.endsWith("/")) continue;

    if (uncompressedSize > maxEntryBytes) {
      throw new Error(`ZIP entry "${name}" exceeds max entry size (${uncompressedSize} > ${maxEntryBytes})`);
    }
    if (totalDecompressed + uncompressedSize > maxTotalBytes) {
      throw new Error(`ZIP archive exceeds total decompressed size limit (${maxTotalBytes} bytes)`);
    }

    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid local file header for "${name}"`);
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) {
      throw new Error(`Truncated ZIP entry data for "${name}"`);
    }

    const rawSlice = buf.subarray(dataStart, dataEnd);
    let content: Buffer;
    if (method === 0) {
      content = Buffer.from(rawSlice);
    } else if (method === 8) {
      content = inflateRawSync(rawSlice, { maxOutputLength: maxEntryBytes });
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for "${name}"`);
    }

    totalDecompressed += content.length;
    if (totalDecompressed > maxTotalBytes) {
      throw new Error(`ZIP archive exceeded total decompressed size limit (${maxTotalBytes} bytes)`);
    }

    entries.set(name.replace(/\\/g, "/"), content);
  }

  return entries;
}

/**
 * Pure-TypeScript zero-dependency ZIP writer (uses deflate method 8).
 */
export function createZipBuffer(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!isSafeZipEntryName(entry.name)) {
      throw new Error(`Unsafe ZIP entry name: "${entry.name}"`);
    }
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const uncompressed = entry.data;
    const compressed = deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBuf, compressed);

    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(0, 8); // flags
    cdHeader.writeUInt16LE(8, 10); // deflate
    cdHeader.writeUInt16LE(0, 12);
    cdHeader.writeUInt16LE(0, 14);
    cdHeader.writeUInt32LE(checksum, 16);
    cdHeader.writeUInt32LE(compressed.length, 20);
    cdHeader.writeUInt32LE(uncompressed.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 34);
    cdHeader.writeUInt16LE(0, 36);
    cdHeader.writeUInt32LE(0, 38);
    cdHeader.writeUInt32LE(offset, 42);

    centralParts.push(cdHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}
