import fs from 'fs';
import path from 'path';

const iconsDir = path.resolve('src-tauri/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Build 16x16 32-bit BMP ICO File structure for MSVC RC.EXE
const width = 16;
const height = 16;
const pixelByteCount = width * height * 4; // 1024 bytes
const maskByteCount = (width * height) / 8; // 32 bytes
const bmpHeaderSize = 40;
const imageDataSize = bmpHeaderSize + pixelByteCount + maskByteCount;
const icoFileSize = 6 + 16 + imageDataSize;

const buffer = Buffer.alloc(icoFileSize);

// 1. ICO Header (6 bytes)
buffer.writeUInt16LE(0, 0); // Reserved
buffer.writeUInt16LE(1, 2); // Type = 1 (ICO)
buffer.writeUInt16LE(1, 4); // Image Count = 1

// 2. Icon Directory Entry (16 bytes)
buffer.writeUInt8(width, 6);   // Width
buffer.writeUInt8(height, 7);  // Height
buffer.writeUInt8(0, 8);       // Color count
buffer.writeUInt8(0, 9);       // Reserved
buffer.writeUInt16LE(1, 10);   // Color planes
buffer.writeUInt16LE(32, 12);  // Bits per pixel
buffer.writeUInt32LE(imageDataSize, 14); // Bytes size
buffer.writeUInt32LE(22, 18);  // Offset (6 + 16 = 22)

// 3. BITMAPINFOHEADER (40 bytes)
let offset = 22;
buffer.writeUInt32LE(40, offset); // biSize
buffer.writeInt32LE(width, offset + 4); // biWidth
buffer.writeInt32LE(height * 2, offset + 8); // biHeight (double for XOR+AND mask)
buffer.writeUInt16LE(1, offset + 12); // biPlanes
buffer.writeUInt16LE(32, offset + 14); // biBitCount
buffer.writeUInt32LE(0, offset + 16); // biCompression (BI_RGB)
buffer.writeUInt32LE(pixelByteCount + maskByteCount, offset + 20); // biSizeImage

offset += bmpHeaderSize;

// 4. Pixel Data (BGRA 32-bit - #007ACC Blue Icon)
for (let i = 0; i < width * height; i++) {
  buffer.writeUInt8(0xCC, offset);     // Blue
  buffer.writeUInt8(0x7A, offset + 1); // Green
  buffer.writeUInt8(0x00, offset + 2); // Red
  buffer.writeUInt8(0xFF, offset + 3); // Alpha (Opaque)
  offset += 4;
}

// 5. AND Mask Data (All 0x00 - fully visible)
buffer.fill(0x00, offset, offset + maskByteCount);

// Write icon.ico
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), buffer);

// Valid minimal PNG payload for PNG icon entries
const pngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSU5EUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

fs.writeFileSync(path.join(iconsDir, '32x32.png'), pngBuffer);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), pngBuffer);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), pngBuffer);
fs.writeFileSync(path.join(iconsDir, 'icon.png'), pngBuffer);
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), pngBuffer);

console.log('Successfully generated MSVC RC.EXE 32-bit BMP icon.ico in src-tauri/icons/');
