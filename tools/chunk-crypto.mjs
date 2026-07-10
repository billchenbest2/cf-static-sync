export function getChunkSeed() {
  const seed = process.env.CHUNK_XOR_SEED;
  if (!seed) throw new Error('CHUNK_XOR_SEED is required');
  return String(seed);
}

function xorBytesUtf8(plain, key) {
  const enc = new TextEncoder();
  const plainBytes = enc.encode(plain);
  const keyBytes = enc.encode(key);
  if (!keyBytes.length) throw new Error('empty xor seed');
  const out = new Uint8Array(plainBytes.length);
  for (let i = 0; i < plainBytes.length; i++) {
    out[i] = plainBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return out;
}

export function encodeXorB64Utf8(plainObject) {
  const plain = JSON.stringify(plainObject);
  const xored = xorBytesUtf8(plain, getChunkSeed());
  return Buffer.from(xored).toString('base64');
}

export function decodeXorB64Utf8(b64Payload, seed) {
  const key = seed || getChunkSeed();
  const bin = Buffer.from(String(b64Payload || ''), 'base64');
  const keyBytes = Buffer.from(key, 'utf8');
  const out = Buffer.alloc(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin[i] ^ keyBytes[i % keyBytes.length];
  }
  return out.toString('utf8');
}

export function buildEncryptedChunkFile(stores, chunkIndex = 0) {
  const inner = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chunkIndex,
    stores
  };
  return {
    schemaVersion: 1,
    encrypted: true,
    encAlg: 'xor-b64-v1',
    payload: encodeXorB64Utf8(inner)
  };
}
