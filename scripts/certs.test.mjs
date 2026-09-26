import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(repo, "deploy", "certs", "private");
const script = path.join(repo, "scripts", "certs.mjs");

function run(store, ...args) {
  return spawnSync(process.execPath, [script, args[0], ...args.slice(1), "--store", store], {
    cwd: repo, encoding: "utf8",
  });
}

function success(store, ...args) {
  const result = run(store, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("CA issues distinct reader credentials; mutual TLS and offline revocation metadata", async () => {
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(path.join(base, "cert-test-"));
  const store = path.basename(directory);
  try {
    success(store, "init");
    success(store, "issue-server");
    success(store, "issue-reader", "--reader-id", "LX-2210-0107");
    success(store, "issue-reader", "--reader-id", "107");
    const caPem = readFileSync(path.join(directory, "ca.crt"));
    const ca = new X509Certificate(caPem);
    const serverPem = readFileSync(path.join(directory, "coordinator", "tls.crt"));
    const server = new X509Certificate(serverPem);
    const reader1Pem = readFileSync(path.join(directory, "readers", "LX-2210-0107", "tls.crt"));
    const reader2Pem = readFileSync(path.join(directory, "readers", "107", "tls.crt"));
    const reader1 = new X509Certificate(reader1Pem);
    const reader2 = new X509Certificate(reader2Pem);
    assert.ok(Date.parse(ca.validTo) > Date.now());
    assert.ok(Date.parse(reader1.validTo) > Date.now());
    assert.equal(ca.ca, true);
    assert.equal(reader1.ca, false);
    assert.equal(reader1.verify(ca.publicKey), true);
    assert.equal(reader2.verify(ca.publicKey), true);
    assert.notEqual(reader1.serialNumber, reader2.serialNumber);
    assert.match(reader1.subjectAltName, /URI:urn:nexo:reader:LX-2210-0107/);
    assert.match(reader2.subjectAltName, /URI:urn:nexo:reader:107/);
    assert.match(server.subjectAltName, /DNS:localhost, IP Address:127\.0\.0\.1/);
    assert.deepEqual(reader1.keyUsage, ["1.3.6.1.5.5.7.3.2"]);
    assert.deepEqual(server.keyUsage, ["1.3.6.1.5.5.7.3.1"]);

    const tlsServer = createServer({
      key: readFileSync(path.join(directory, "coordinator", "tls.key")),
      cert: serverPem, ca: caPem, requestCert: true, rejectUnauthorized: true,
    });
    await new Promise((resolve) => tlsServer.listen(0, "127.0.0.1", resolve));
    try {
      const client = connect({
        port: tlsServer.address().port, host: "127.0.0.1", servername: "localhost",
        ca: caPem, cert: reader1Pem,
        key: readFileSync(path.join(directory, "readers", "LX-2210-0107", "tls.key")),
        rejectUnauthorized: true,
      });
      await new Promise((resolve, reject) => {
        client.once("secureConnect", resolve);
        client.once("error", reject);
      });
      assert.equal(client.authorized, true);
      client.destroy();
    } finally {
      await new Promise((resolve) => tlsServer.close(resolve));
    }

    assert.notEqual(run(store, "issue-reader", "--reader-id", "LX-2210-0107").status, 0);
    assert.notEqual(run(store, "issue-reader", "--reader-id", "../escape").status, 0);
    success(store, "revoke", "--reader-id", "LX-2210-0107", "--reason", "compromised");
    success(store, "revoke", "--reader-id", "LX-2210-0107");
    const list = JSON.parse(readFileSync(path.join(directory, "revoked.json"), "utf8"));
    assert.equal(list.version, 1);
    assert.equal(list.issuerFingerprint256, ca.fingerprint256.replaceAll(":", "").toLowerCase());
    assert.equal(list.revoked.length, 1);
    assert.equal(list.revoked[0].readerId, "LX-2210-0107");
    assert.equal(list.revoked[0].serialNumber, reader1.serialNumber);
    assert.equal(list.revoked[0].fingerprint256, reader1.fingerprint256.replaceAll(":", "").toLowerCase());
    assert.ok(Number.isFinite(Date.parse(list.revoked[0].revokedAt)));
    assert.equal(list.revoked[0].reason, "compromised");
    assert.equal(JSON.parse(success(store, "status", "--reader-id", "LX-2210-0107")).revoked, true);
    assert.equal(JSON.parse(success(store, "status", "--reader-id", "107")).revoked, false);
    writeFileSync(path.join(directory, "revoked.json"), JSON.stringify({
      ...list, issuerFingerprint256: "0".repeat(64),
    }));
    assert.notEqual(run(store, "status", "--reader-id", "107").status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
