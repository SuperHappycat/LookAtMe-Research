/**
 * lib/research/exports/zip.ts
 * =============================
 * Minimal ZIP writer: STORE method only (no compression), CRC-32, UTF-8 file
 * names. Enough to bundle a handful of small text files into one download
 * without adding a dependency. Pure: no browser APIs, so it runs under node --test.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

/** Standard CRC-32 (IEEE 802.3, as used by ZIP and PNG). */
export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time fields (local time, 2-second resolution, years 1980-2107). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const enc = new TextEncoder();

/** Builds a .zip archive (STORE, no compression) of the given files. */
export function zipStore(entries: readonly ZipEntry[], modified: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(modified);
  const files = entries.map((e) => {
    const name = enc.encode(e.name);
    const data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    return { name, data, crc: crc32(data) };
  });

  const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v: number) => {
    view.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(p, v >>> 0, true);
    p += 4;
  };
  const bytes = (b: Uint8Array) => {
    out.set(b, p);
    p += b.length;
  };

  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(p);
    u32(0x04034b50); // local file header signature
    u16(20); // version needed: 2.0
    u16(0x0800); // flags: bit 11 = names are UTF-8
    u16(0); // method: STORE
    u16(time);
    u16(date);
    u32(f.crc);
    u32(f.data.length); // compressed size
    u32(f.data.length); // uncompressed size
    u16(f.name.length);
    u16(0); // extra field length
    bytes(f.name);
    bytes(f.data);
  }

  const centralStart = p;
  files.forEach((f, i) => {
    u32(0x02014b50); // central directory header signature
    u16(20); // version made by
    u16(20); // version needed
    u16(0x0800);
    u16(0);
    u16(time);
    u16(date);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]);
    bytes(f.name);
  });

  u32(0x06054b50); // end of central directory
  u16(0);
  u16(0);
  u16(files.length);
  u16(files.length);
  u32(centralSize);
  u32(centralStart);
  u16(0); // comment length
  return out;
}
