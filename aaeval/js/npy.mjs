// numpy の .npy を読む（試験用。bool・uint8・int8・int32・int64・float32・float64）
import { readFileSync } from "node:fs";

const TYPES = {
  "|b1": Uint8Array, "|u1": Uint8Array, "|i1": Int8Array, "<i4": Int32Array, "<i8": BigInt64Array,
  "<f4": Float32Array, "<f8": Float64Array,
};

export function loadNpy(path) {
  const buf = readFileSync(path);
  if (buf[0] !== 0x93 || buf.toString("latin1", 1, 6) !== "NUMPY") throw new Error(`${path}: not npy`);
  const major = buf[6];
  const hlen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const start = (major === 1 ? 10 : 12) + hlen;
  const header = buf.toString("latin1", major === 1 ? 10 : 12, start);
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  if (/'fortran_order':\s*True/.test(header)) throw new Error(`${path}: fortran order`);
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const T = TYPES[descr];
  if (!T) throw new Error(`${path}: dtype ${descr}`);
  const bytes = buf.subarray(start);
  const data = new T(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { data: T === BigInt64Array ? Int32Array.from(data, Number) : data, shape };
}
