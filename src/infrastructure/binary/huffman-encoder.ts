import { EaFileError } from '../../domain/errors.js';
import type { DecodeBudget } from '../../domain/limits.js';

interface Node {
  readonly weight: number;
  readonly order: number;
  readonly symbol?: number;
  readonly left?: Node;
  readonly right?: Node;
}

export interface PoolString {
  readonly value: string;
  readonly long: boolean;
}

export interface StringPool {
  readonly bytes: Uint8Array;
  readonly pointers: ReadonlyMap<string, number>;
}

export function stringKey(value: string, long: boolean): string {
  return `${long ? 14 : 13}:${value}`;
}

export function encodeStringPool(strings: readonly PoolString[], bigEndian: boolean, budget: DecodeBudget): StringPool {
  const unique = new Map<string, { bytes: Uint8Array; long: boolean }>();
  const weights = new Float64Array(256);
  for (const { value, long } of strings) {
    if (typeof value !== 'string' || value.includes('\0')) throw new EaFileError('INVALID_WRITE', 'Strings must not contain null characters.');
    if (value.length === 0) continue;
    if (value.length > (long ? 65535 : 255)) throw new EaFileError('INVALID_WRITE', 'Compressed string exceeds its length prefix.');
    const bytes = new TextEncoder().encode(value);
    if (new TextDecoder().decode(bytes) !== value) throw new EaFileError('INVALID_WRITE', 'Strings must contain well-formed Unicode.');
    if (bytes.length > (long ? 65535 : 255)) throw new EaFileError('INVALID_WRITE', 'Compressed UTF-8 string exceeds its length prefix.');
    budget.addString(bytes.length, 0);
    const key = stringKey(value, long);
    if (unique.has(key)) continue;
    unique.set(key, { bytes, long });
    for (const byte of bytes) weights[byte] = weights[byte]! + 1;
  }
  if (unique.size === 0) return { bytes: new Uint8Array(), pointers: new Map() };
  const queue: Node[] = [];
  for (let symbol = 0; symbol < 256; symbol++) {
    if (weights[symbol]! > 0) queue.push({ weight: weights[symbol]!, order: symbol, symbol });
  }
  while (queue.length > 1) {
    queue.sort((a, b) => a.weight - b.weight || a.order - b.order);
    const left = queue.shift()!, right = queue.shift()!;
    queue.push({ weight: left.weight + right.weight, order: Math.min(left.order, right.order), left, right });
  }
  let root = queue[0]!;
  if (root.symbol !== undefined) root = { weight: root.weight, order: root.order, left: root, right: root };
  const nodes: number[][] = [];
  const codes = new Map<number, readonly number[]>();
  const visit = (node: Node, path: readonly number[]): number => {
    const index = nodes.length;
    const encoded = [0, 0, 0, 0];
    nodes.push(encoded);
    for (const [branch, child] of [node.left!, node.right!].entries()) {
      const bits = [...path, branch];
      if (child.symbol !== undefined) {
        encoded[branch * 2 + 1] = child.symbol;
        if (!codes.has(child.symbol)) codes.set(child.symbol, bits);
      } else encoded[branch * 2] = visit(child, bits);
    }
    return index;
  };
  visit(root, []);
  const parts: Uint8Array[] = [Uint8Array.from(nodes.flat())];
  const pointers = new Map<string, number>();
  let length = parts[0]!.length;
  for (const [key, { bytes, long }] of unique) {
    let bitCount = 0;
    for (const byte of bytes) bitCount += codes.get(byte)!.length;
    const prefix = long ? 2 : 1;
    const encoded = new Uint8Array(prefix + Math.ceil(bitCount / 8));
    if (long) new DataView(encoded.buffer).setUint16(0, bytes.length, bigEndian);
    else encoded[0] = bytes.length;
    let cursor = 0;
    for (const byte of bytes) {
      for (const bit of codes.get(byte)!) {
        const offset = prefix + Math.floor(cursor / 8);
        encoded[offset] = encoded[offset]! | (bit << (7 - cursor % 8));
        cursor++;
      }
    }
    pointers.set(key, length);
    length += encoded.length;
    if (length > budget.limits.maxFileBytes) throw new EaFileError('LIMIT_EXCEEDED', 'Encoded string pool exceeds maxFileBytes.');
    parts.push(encoded);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { bytes, pointers };
}
