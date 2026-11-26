// Explicitly run once per authorized UAT exercise; never used by the test suites.
const {
  createHash,
  randomBytes,
  randomUUID,
  publicEncrypt,
  createCipheriv,
  constants,
} = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

function preserveDatabase(paymentRequested, confirmedFinal) {
  return paymentRequested && !confirmedFinal;
}
function matchesDecline(result) {
  return (
    result.status === 'DECLINED' &&
    result.reservationStatus === 'RELEASED' &&
    result.checkoutStatus === 'DRAFT' &&
    result.after.stock === result.before.stock &&
    result.after.deliveries === result.before.deliveries &&
    result.after.held === 0
  );
}
function safeDiagnostic(value) {
  if (
    !value ||
    !['configuration', 'creation', 'query'].includes(value.stage) ||
    ![
      'VALIDATED',
      'GATEWAY_CONFIGURATION',
      'GATEWAY_TRANSPORT',
      'GATEWAY_HTTP',
      'GATEWAY_JSON',
      'GATEWAY_SCHEMA',
    ].includes(value.code)
  )
    return null;
  const event = { stage: value.stage, code: value.code };
  if (
    Number.isInteger(value.httpStatus) &&
    value.httpStatus >= 100 &&
    value.httpStatus <= 599
  )
    event.httpStatus = value.httpStatus;
  for (const key of ['localId', 'reference', 'remoteId']) {
    if (
      typeof value[key] === 'string' &&
      /^[a-zA-Z0-9._:-]{1,128}$/.test(value[key])
    )
      event[key] = value[key];
  }
  return event;
}
function encryptCard(card, publicKey) {
  const protectedHeader = Buffer.from(
    JSON.stringify({ alg: 'RSA-OAEP-256', enc: 'A256GCM' }),
  ).toString('base64url');
  const cek = randomBytes(32),
    iv = randomBytes(12);
  const encryptedKey = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    cek,
  );
  const cipher = createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(Buffer.from(protectedHeader));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(card), 'utf8'),
    cipher.final(),
  ]);
  return [
    protectedHeader,
    encryptedKey.toString('base64url'),
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}
function revision(backend) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: path.resolve(backend, '..'),
      encoding: 'utf8',
      windowsHide: true,
    });
  const diff = git('diff', '--no-ext-diff', '--no-color', 'HEAD');
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter(Boolean)
    .sort();
  return {
    head: git('rev-parse', 'HEAD').trim(),
    diffSha256: createHash('sha256').update(diff).digest('hex'),
    // git diff alone omits new files: bind their paths and content too.
    newFilesSha256: createHash('sha256')
      .update(
        untracked
          .map(
            (file) =>
              file +
              '\0' +
              createHash('sha256')
                .update(readFileSync(path.resolve(backend, '..', file)))
                .digest('hex'),
          )
          .join('\n'),
      )
      .digest('hex'),
  };
}
function checkpoint(file, evidence) {
  // Called before teardown; failures here must never authorize deleting uncertain data.
  writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}
async function main() {
  const backend = path.resolve(__dirname, '..');
  const { Client } = require('pg');
  const { DataSource } = require('typeorm');
  const {
    loadDatabaseEnvironment,
  } = require('../dist/infrastructure/database/load-environment');
  const {
    createDatabaseOptions,
  } = require('../dist/infrastructure/database/database-options');
  const {
    seedProducts,
  } = require('../dist/infrastructure/database/seed-products');
  const env = loadDatabaseEnvironment();
  const host = 'https://api-sandbox.co.uat.wompi.dev';
  if (
    process.env.WOMPI_BASE_URL?.replace(/\/$/, '').replace(/\/v1$/, '') !==
      host ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  )
    throw new Error('UNSAFE_UAT_CONFIGURATION');
  const missing = [
    'WOMPI_PUBLIC_KEY',
    'WOMPI_PRIVATE_KEY',
    'WOMPI_INTEGRITY_SECRET',
    'UAT_DECLINED_CARD',
    'UAT_CVC',
    'UAT_EVIDENCE_DIR',
  ].filter((key) => !process.env[key]);
  if (missing.length) throw new Error('MISSING_' + missing.join('_'));
  const card = {
    number: process.env.UAT_DECLINED_CARD,
    cvc: process.env.UAT_CVC,
    exp_month: '12',
    exp_year: '30',
    card_holder: 'Sandbox Client',
  };
  delete process.env.UAT_DECLINED_CARD;
  delete process.env.UAT_CVC;
  const output = path.resolve(process.env.UAT_EVIDENCE_DIR);
  if (
    output === path.resolve(backend, '..') ||
    output.startsWith(path.resolve(backend, '..') + path.sep)
  )
    throw new Error('EVIDENCE_MUST_BE_OUTSIDE_REPOSITORY');
  mkdirSync(output, { recursive: true });
  const evidenceFile = path.join(output, 'uat-results.json');
  const dbName = 'payment_checkout_test_' + randomBytes(8).toString('hex');
  if (
    !/^payment_checkout_test_[0-9a-f]{16}$/.test(dbName) ||
    dbName === env.DB_NAME
  )
    throw new Error('UNSAFE_DATABASE');
  const evidence = {
    startedAt: new Date().toISOString(),
    host,
    revision: revision(backend),
    database: dbName,
    expected: 'DECLINED',
    localHttp: [],
    providerHttp: [],
    diagnostics: [],
    paymentRequests: 0,
    success: false,
    fixtureSource:
      'https://docs.wompi.co/en/docs/colombia/datos-de-prueba-en-sandbox/',
    encryption: 'RSA-OAEP-256/A256GCM',
    tlsValidated: true,
    databaseRemoved: false,
  };
  const save = () => checkpoint(evidenceFile, evidence);
  const admin = new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'postgres',
  });
  let child,
    db,
    created = false,
    paymentRequested = false,
    confirmedFinal = false,
    checkpointSaved = false;
  let cookie, csrf;
  const localBase = 'http://localhost:3102/api/v1';
  async function local(method, route, body, extra = {}) {
    const response = await fetch(localBase + route, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Origin: 'http://localhost:3000',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    evidence.localHttp.push({ method, route, status: response.status });
    save();
    const json = await response.json();
    if (!response.ok) throw new Error('LOCAL_HTTP_' + response.status);
    return {
      data: json.data,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  async function provider(route, method = 'GET', body) {
    const response = await fetch(host + route, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: 'Bearer ' + process.env.WOMPI_PUBLIC_KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    evidence.providerHttp.push({ method, route, status: response.status });
    save();
    if (!response.ok) throw new Error('PROVIDER_HTTP_' + response.status);
    return response.json();
  }
  async function counts() {
    const [row] = await db.query(
      "SELECT (SELECT stock FROM products WHERE sku='AUD-001') stock, (SELECT count(*)::int FROM deliveries) deliveries, (SELECT count(*)::int FROM inventory_reservations WHERE status='HELD') held",
    );
    return row;
  }
  try {
    save();
    await admin.connect();
    await admin.query('CREATE DATABASE ' + dbName);
    created = true;
    db = new DataSource(createDatabaseOptions({ ...env, DB_NAME: dbName }));
    await db.initialize();
    await db.runMigrations();
    await seedProducts(db);
    child = spawn(process.execPath, ['dist/main.js'], {
      cwd: backend,
      windowsHide: true,
      env: { ...process.env, DB_NAME: dbName, PORT: '3102' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Discard ordinary startup logs; persist only parsed, allowlisted diagnostics.
    let buffered = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split('\n');
      buffered = lines.pop().slice(-8192);
      for (const line of lines) {
        const match = line.match(/\{"stage":.*\}/);
        if (match) {
          try {
            const event = safeDiagnostic(JSON.parse(match[0]));
            if (event) {
              evidence.diagnostics.push(event);
              save();
            }
          } catch {
            /* Ignore non-diagnostic stdout, never save raw output. */
          }
        }
      }
    });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch('http://localhost:3102/');
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Startup readiness only, no payment retry. */
      }
      await delay(200);
    }
    if (!ready) throw new Error('LOCAL_API_UNAVAILABLE');
    const guest = await local('POST', '/checkout-sessions');
    cookie = guest.cookie;
    csrf = guest.data?.csrfToken;
    if (!cookie || !csrf) throw new Error('LOCAL_SESSION_UNAVAILABLE');
    const config = (await local('GET', '/payments/config')).data;
    const keyBody = await provider('/v1/tokens/keys/tokenization');
    const pem = keyBody?.data?.publicKey;
    if (typeof pem !== 'string') throw new Error('INVALID_TOKENIZATION_KEY');
    const encoded = pem
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    const key =
      '-----BEGIN PUBLIC KEY-----\n' +
      encoded.match(/.{1,64}/g).join('\n') +
      '\n-----END PUBLIC KEY-----';
    const payload = encryptCard(card, key);
    // No PAN or CVC reaches the local backend, log or evidence file.
    const cardToken = (await provider('/v1/tokens/cards', 'POST', { payload }))
      ?.data?.id;
    if (typeof cardToken !== 'string') throw new Error('INVALID_CARD_TOKEN');
    const draft = await local('POST', '/checkouts', {
      productId: '11111111-1111-4111-8111-111111111111',
      quantity: 1,
    });
    const checkoutId = draft.data?.id;
    if (!checkoutId) throw new Error('CHECKOUT_UNAVAILABLE');
    await local('PATCH', '/checkouts/' + checkoutId, {
      buyer: {
        fullName: 'Sandbox Client',
        email: 'sandbox-client@example.test',
        phone: '+573000000000',
      },
      delivery: {
        recipientName: 'Sandbox Client',
        phone: '+573000000000',
        addressLine1: 'Calle de prueba 1',
        city: 'Bogota',
        region: 'Bogota',
        country: 'CO',
      },
    });
    const s = (await local('GET', '/checkouts/' + checkoutId + '/summary'))
      .data;
    evidence.before = await counts();
    const attempt = await local(
      'POST',
      '/transactions',
      {
        checkoutId,
        acceptedSummary: {
          quantity: s.quantity,
          unitPriceCents: s.unitPriceCents,
          baseFeeCents: s.baseFeeCents,
          deliveryFeeCents: s.deliveryFeeCents,
          currency: s.currency,
        },
      },
      { 'Idempotency-Key': randomUUID() },
    );
    const id = attempt.data?.id;
    if (!id) throw new Error('ATTEMPT_UNAVAILABLE');
    evidence.localId = id;
    evidence.checkoutId = checkoutId;
    evidence.reserved = await counts();
    save();
    paymentRequested = true;
    evidence.paymentRequests = 1;
    save();
    let response = await local('POST', '/transactions/' + id + '/pay', {
      cardToken,
      installments: 1,
      acceptance: {
        acceptanceToken: config.acceptance.acceptanceToken,
        personalAuthToken: config.acceptance.personalAuthToken,
        policyAccepted: true,
        personalDataAccepted: true,
      },
    });
    for (
      let n = 0;
      n < 12 &&
      response.data?.status === 'PENDING' &&
      response.data.dispatchStatus === 'SUBMITTED';
      n++
    ) {
      await delay(2500);
      response = await local('POST', '/transactions/' + id + '/sync');
    }
    const detail = (await local('GET', '/transactions/' + id)).data;
    const [row] = await db.query(
      'SELECT reference, provider_transaction_id, last_error_code FROM transactions WHERE id=$1',
      [id],
    );
    const [checkout] = await db.query(
      'SELECT status FROM checkouts WHERE id=$1',
      [checkoutId],
    );
    evidence.result = {
      status: detail.status,
      dispatchStatus: detail.dispatchStatus,
      reservationStatus: detail.reservationStatus,
      reference: row.reference,
      remoteId: row.provider_transaction_id,
      sanitizedCode: row.last_error_code,
      checkoutStatus: checkout.status,
      before: evidence.before,
      after: await counts(),
    };
    confirmedFinal = ['APPROVED', 'DECLINED', 'VOIDED', 'ERROR'].includes(
      detail.status,
    );
    evidence.success = matchesDecline(evidence.result);
    if (!evidence.success) process.exitCode = 1;
  } catch (error) {
    // Persist only our own fixed codes. Never exception messages from network/crypto/SQL.
    evidence.failure =
      typeof error?.message === 'string' &&
      /^(?:LOCAL|PROVIDER|INVALID|CHECKOUT|ATTEMPT|DRAFT)_[A-Z_0-9]+$/.test(
        error.message,
      )
        ? error.message
        : 'VERIFICATION_FAILED';
    process.exitCode = 1;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.databasePreserved = preserveDatabase(
      paymentRequested,
      confirmedFinal,
    );
    try {
      save();
      checkpointSaved = true;
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await exited;
      }
      if (db?.isInitialized) await db.destroy();
      if (created && checkpointSaved && !evidence.databasePreserved) {
        await admin.query('DROP DATABASE ' + dbName);
        evidence.databaseRemoved = true;
      }
      await admin.end();
    }
    save();
    console.log(
      JSON.stringify({
        success: evidence.success,
        databasePreserved: evidence.databasePreserved,
        evidenceFile,
      }),
    );
  }
}
module.exports = {
  preserveDatabase,
  matchesDecline,
  safeDiagnostic,
  encryptCard,
  revision,
  checkpoint,
};
if (require.main === module)
  main().catch(() => {
    console.error(
      'VERIFICATION_FAILED; preserve any created database and inspect sanitized evidence.',
    );
    process.exitCode = 1;
  });
