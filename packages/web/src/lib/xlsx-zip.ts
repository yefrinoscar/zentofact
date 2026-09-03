const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

function u16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

function findEocd(bytes: Uint8Array) {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (u32(bytes, offset) === EOCD_SIG) return offset;
  }
  return -1;
}

/** Falabella writes ZIP data descriptors (local sizes = 0). SheetJS then drops the sheet. */
export function repairSpreadsheetZip(input: ArrayBuffer | Uint8Array) {
  const source = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (source.length < 22 || u32(source, 0) !== LOCAL_SIG) return source;
  const eocd = findEocd(source);
  if (eocd < 0) return source;
  const count = u16(source, eocd + 10);
  let offset = u32(source, eocd + 16);
  const out = new Uint8Array(source.length);
  out.set(source);
  let patched = false;
  for (let index = 0; index < count; index += 1) {
    if (u32(out, offset) !== CENTRAL_SIG) break;
    const nameLen = u16(out, offset + 28);
    const extraLen = u16(out, offset + 30);
    const commentLen = u16(out, offset + 32);
    const localOff = u32(out, offset + 42);
    const compSize = u32(out, offset + 20);
    const uncompSize = u32(out, offset + 24);
    if (u32(out, localOff) === LOCAL_SIG) {
      const localFlag = u16(out, localOff + 6);
      if ((localFlag & 0x8) || u32(out, localOff + 18) === 0 || u32(out, localOff + 22) === 0) {
        writeU16(out, localOff + 6, localFlag & ~0x8);
        writeU32(out, localOff + 18, compSize);
        writeU32(out, localOff + 22, uncompSize);
        writeU16(out, offset + 8, u16(out, offset + 8) & ~0x8);
        patched = true;
      }
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return patched ? out : source;
}

export function zipLocalSizes(bytes: Uint8Array) {
  const eocd = findEocd(bytes);
  if (eocd < 0) return [] as Array<{ name: string; localOff: number; localComp: number; localUncomp: number; cdComp: number; cdUncomp: number }>;
  const count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    if (u32(bytes, offset) !== CENTRAL_SIG) break;
    const nameLen = u16(bytes, offset + 28);
    const extraLen = u16(bytes, offset + 30);
    const commentLen = u16(bytes, offset + 32);
    const localOff = u32(bytes, offset + 42);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    rows.push({
      name,
      localOff,
      localComp: u32(bytes, localOff + 18),
      localUncomp: u32(bytes, localOff + 22),
      cdComp: u32(bytes, offset + 20),
      cdUncomp: u32(bytes, offset + 24),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return rows;
}
