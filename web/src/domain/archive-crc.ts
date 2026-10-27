const table = new DataView(new ArrayBuffer(256 * 4))
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320
  table.setUint32(index * 4, value, true)
}

export function updateArchiveCrc(crc: number, bytes: Uint8Array): number {
  let value = crc
  for (const byte of bytes)
    value = (value >>> 8) ^ table.getUint32(((value ^ byte) & 255) * 4, true)
  return value >>> 0
}
