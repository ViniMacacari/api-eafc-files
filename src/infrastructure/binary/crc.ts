const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index << 24;
  for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ (value < 0 ? 0x04c11db7 : 0);
  return value >>> 0;
});

export function databaseCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = ((crc << 8) ^ table[((crc >>> 24) ^ byte) & 255]!) >>> 0;
  return crc;
}
