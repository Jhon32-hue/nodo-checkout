const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateKeyPairSync,
  privateDecrypt,
  createDecipheriv,
  constants,
} = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  preserveDatabase,
  matchesDecline,
  safeDiagnostic,
  encryptCard,
  revision,
  checkpoint,
} = require('./verify-declined.cjs');

test('retains uncertain real attempts, including a lost local HTTP response', () => {
  assert.equal(preserveDatabase(true, false), true);
  assert.equal(preserveDatabase(true, true), false);
  assert.equal(preserveDatabase(false, false), false);
});
test('unexpected status or broken decline invariants fails verification', () => {
  const expected = {
    status: 'DECLINED',
    reservationStatus: 'RELEASED',
    checkoutStatus: 'DRAFT',
    before: { stock: 10, deliveries: 0 },
    after: { stock: 10, deliveries: 0, held: 0 },
  };
  assert.equal(matchesDecline(expected), true);
  for (const patch of [
    { status: 'PENDING' },
    { status: 'APPROVED' },
    { reservationStatus: 'HELD' },
    { checkoutStatus: 'PAID' },
    { after: { stock: 9, deliveries: 0, held: 0 } },
    { after: { stock: 10, deliveries: 1, held: 0 } },
  ]) {
    assert.equal(matchesDecline({ ...expected, ...patch }), false);
  }
});
test('diagnostic evidence rejects arbitrary properties and unknown messages', () => {
  const event = safeDiagnostic({
    stage: 'creation',
    code: 'GATEWAY_HTTP',
    httpStatus: 422,
    localId: 'local',
    reference: 'ref',
    remoteId: 'remote',
    body: 'secret-body',
    Authorization: 'secret-key',
    cardToken: 'secret-token',
    PAN: 'secret-pan',
    cvc: 'secret-cvc',
    buyer: 'secret-buyer',
  });
  assert.deepEqual(event, {
    stage: 'creation',
    code: 'GATEWAY_HTTP',
    httpStatus: 422,
    localId: 'local',
    reference: 'ref',
    remoteId: 'remote',
  });
  assert.equal(JSON.stringify(event).includes('secret'), false);
  assert.equal(
    safeDiagnostic({ stage: 'creation', code: 'secret-error-message' }),
    null,
  );
});
test('encrypted tokenization uses authenticated JWE with RSA-OAEP-256 and A256GCM', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const card = { number: 'fictional-number', cvc: 'fictional-cvc' };
  const jwe = encryptCard(card, publicKey);
  const [header, key, iv, ciphertext, tag] = jwe.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), {
    alg: 'RSA-OAEP-256',
    enc: 'A256GCM',
  });
  const cek = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(key, 'base64url'),
  );
  const decipher = createDecipheriv(
    'aes-256-gcm',
    cek,
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(header));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  assert.deepEqual(
    JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]),
    ),
    card,
  );
  assert.equal(jwe.includes(card.number), false);
  assert.equal(jwe.includes(card.cvc), false);
});
test('checkpoint writes sanitized evidence while database is still present', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'payment-evidence-test-'));
  try {
    const file = path.join(dir, 'evidence.json');
    const evidence = {
      databaseRemoved: false,
      result: { status: 'PENDING', dispatchStatus: 'UNKNOWN' },
    };
    checkpoint(file, evidence);
    assert.deepEqual(JSON.parse(readFileSync(file)), evidence);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test('revision identifies HEAD and both tracked diff and new source content', () => {
  const result = revision(path.resolve(__dirname, '..'));
  assert.match(result.head, /^[a-f0-9]{40}$/);
  assert.match(result.diffSha256, /^[a-f0-9]{64}$/);
  assert.match(result.newFilesSha256, /^[a-f0-9]{64}$/);
});
