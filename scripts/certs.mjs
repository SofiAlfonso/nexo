#!/usr/bin/env node
import { randomBytes, generateKeyPairSync, createPrivateKey, sign, X509Certificate } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync, renameSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const privateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "deploy", "certs", "private");
const usage = `Usage: node scripts/certs.mjs <command> [options]
  init [--store NAME]                          Create laboratory CA and empty revocation list
  issue-reader --reader-id ID [--store NAME]   Issue one unique client credential
  issue-server [--dns HOST] [--ip ADDRESS] [--store NAME]
                                               Issue coordinator server credential once
  revoke --reader-id ID [--reason lost|compromised|retired] [--store NAME]
                                               Revoke a reader credential offline
  status --reader-id ID [--store NAME]         Inspect issued credential and revocation

Default output: deploy/certs/private/ (ignored by Git). --store NAME selects an
isolated subdirectory there. The CA private key is unencrypted: laboratory use only.`;

function field(name, value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value ?? "")) {
    throw new Error(`${name} must contain 1–64 ASCII letters, digits, hyphens or underscores`);
  }
  return value;
}

function parseArgs(args) {
  const [command, ...rest] = args;
  const options = {};
  const allowed = new Set(["--reader-id", "--store", "--dns", "--ip", "--reason"]);
  if (!["init", "issue-reader", "issue-server", "revoke", "status"].includes(command)) {
    throw new Error(usage);
  }
  for (let i = 0; i < rest.length; i += 2) {
    if (!allowed.has(rest[i]) || options[rest[i]] !== undefined || !rest[i + 1] || rest[i + 1].startsWith("--")) {
      throw new Error(usage);
    }
    options[rest[i]] = rest[i + 1];
  }
  const permitted = {
    init: ["--store"],
    "issue-reader": ["--reader-id", "--store"],
    "issue-server": ["--dns", "--ip", "--store"],
    revoke: ["--reader-id", "--reason", "--store"],
    status: ["--reader-id", "--store"],
  };
  if (Object.keys(options).some((option) => !permitted[command].includes(option))) throw new Error(usage);
  if (["issue-reader", "revoke", "status"].includes(command)) field("readerId", options["--reader-id"]);
  if (options["--store"]) field("store", options["--store"]);
  return { command, options, root: options["--store"] ? path.join(privateRoot, options["--store"]) : privateRoot };
}

function ensureDirectory(directory) {
  if (existsSync(directory)) {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
      throw new Error(`Not a real directory: ${directory}`);
    }
    return;
  }
  ensureDirectory(path.dirname(directory));
  mkdirSync(directory);
}

function der(tag, ...parts) {
  const content = Buffer.concat(parts);
  let length = Buffer.from([content.length]);
  if (content.length >= 128) {
    const bytes = [];
    for (let n = content.length; n; n = Math.floor(n / 256)) bytes.unshift(n & 255);
    length = Buffer.from([0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), length, content]);
}

const sequence = (...parts) => der(0x30, ...parts);
const octet = (bytes) => der(0x04, bytes);
const bitString = (bytes, unused = 0) => der(0x03, Buffer.from([unused]), bytes);
const integer = (bytes) => der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);

function oid(text) {
  const values = text.split(".").map(Number);
  if (values.length < 2 || values[0] > 2 || values[1] >= 40) throw new Error("Invalid OID");
  const bytes = [values[0] * 40 + values[1]];
  for (const value of values.slice(2)) {
    const encoded = [value & 127];
    for (let n = Math.floor(value / 128); n; n = Math.floor(n / 128)) encoded.unshift((n & 127) | 128);
    bytes.push(...encoded);
  }
  return der(0x06, Buffer.from(bytes));
}

function name(commonName) {
  return sequence(der(0x31, sequence(oid("2.5.4.3"), der(0x0c, Buffer.from(commonName, "utf8")))));
}

function time(date) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace("T", "").replace(/\.\d{3}Z$/, "Z");
  return der(date.getUTCFullYear() < 2050 ? 0x17 : 0x18, Buffer.from(date.getUTCFullYear() < 2050 ? stamp.slice(2) : stamp));
}

function extension(id, content, critical = false) {
  return sequence(oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), octet(content));
}

const signatureAlgorithm = sequence(oid("1.2.840.10045.4.3.2"));

function certificate({ subject, issuer, publicKey, signingKey, ca = false, san, usage, days }) {
  const now = Date.now();
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const extensions = [
    extension("2.5.29.19", ca ? sequence(der(0x01, Buffer.from([0xff])), integer(Buffer.from([0]))) : sequence(), true),
    extension("2.5.29.15", bitString(Buffer.from([ca ? 0x06 : 0x80]), ca ? 1 : 7), true),
  ];
  if (usage) extensions.push(extension("2.5.29.37", sequence(oid(usage))));
  if (san) extensions.push(extension("2.5.29.17", sequence(...san)));
  const tbs = sequence(
    der(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    signatureAlgorithm,
    name(issuer),
    sequence(time(new Date(now - 300_000)), time(new Date(now + days * 86_400_000))),
    name(subject),
    publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, sequence(...extensions)),
  );
  const signature = sign("sha256", tbs, signingKey);
  const bytes = sequence(tbs, signatureAlgorithm, bitString(signature));
  const base64 = bytes.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

function fingerprint(cert) {
  return cert.fingerprint256.replaceAll(":", "").toLowerCase();
}

function loadCa(root) {
  const ca = new X509Certificate(readFileSync(path.join(root, "ca.crt")));
  const key = readFileSync(path.join(root, "ca.key"));
  if (!ca.checkPrivateKey(createPrivateKey(key)) || !ca.verify(ca.publicKey)) throw new Error("Laboratory CA key/certificate mismatch");
  if (!Number.isFinite(Date.parse(ca.validTo))) throw new Error("Laboratory CA expiration is invalid");
  return { ca, key };
}

function loadRevocations(root, ca) {
  const document = JSON.parse(readFileSync(path.join(root, "revoked.json"), "utf8"));
  if (document.version !== 1 || document.issuerFingerprint256 !== fingerprint(ca) ||
      !Array.isArray(document.revoked) ||
      document.revoked.some((entry) => !entry || !field("readerId", entry.readerId) ||
        typeof entry.serialNumber !== "string" || !/^[0-9A-F]+$/.test(entry.serialNumber) ||
        typeof entry.fingerprint256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.fingerprint256) ||
        !Number.isFinite(Date.parse(entry.revokedAt)) ||
        !["lost", "compromised", "retired"].includes(entry.reason))) {
    throw new Error("Invalid revocation list or issuer fingerprint");
  }
  return document;
}

function writeNew(file, value, mode) {
  writeFileSync(file, value, { flag: "wx", mode });
}

function init(root) {
  ensureDirectory(root);
  if (["ca.key", "ca.crt", "revoked.json"].some((name) => existsSync(path.join(root, name)))) {
    throw new Error("CA already initialized (or incomplete); refusing to overwrite it");
  }
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const cert = certificate({
    subject: "NEXO laboratory CA", issuer: "NEXO laboratory CA",
    publicKey: pair.publicKey, signingKey: pair.privateKey, ca: true, days: 365,
  });
  const x509 = new X509Certificate(cert);
  if (!x509.ca || !x509.verify(pair.publicKey)) throw new Error("Generated CA is invalid");
  writeNew(path.join(root, "ca.key"), key, 0o600);
  writeNew(path.join(root, "ca.crt"), cert, 0o644);
  writeNew(path.join(root, "revoked.json"), JSON.stringify({
    version: 1, issuerFingerprint256: fingerprint(x509), revoked: [],
  }, null, 2) + "\n", 0o600);
  console.log(`Laboratory CA initialized in ${root}`);
}

function issue(root, readerId, serverOptions) {
  const { ca, key: caKey } = loadCa(root);
  if (Date.parse(ca.validTo) < Date.now() + 31 * 86_400_000) {
    throw new Error("Laboratory CA expires in less than 31 days; rotate the CA before issuing");
  }
  loadRevocations(root, ca);
  const isServer = readerId === null;
  const directory = isServer ? path.join(root, "coordinator") : path.join(root, "readers", readerId);
  if (!isServer) ensureDirectory(path.join(root, "readers"));
  if (existsSync(directory)) throw new Error(`Credential already exists: ${directory}; never reuse a reader identity`);
  let san;
  if (isServer) {
    const dns = serverOptions["--dns"] ?? "localhost";
    const ip = serverOptions["--ip"] ?? "127.0.0.1";
    if (!/^[a-zA-Z0-9.-]{1,253}$/.test(dns) || dns.startsWith(".") || dns.endsWith(".")) {
      throw new Error("Invalid DNS name");
    }
    if (!isIP(ip)) throw new Error("Invalid IP address");
    const ipBytes = isIP(ip) === 4 ? Buffer.from(ip.split(".").map(Number)) : null;
    if (!ipBytes) throw new Error("Only IPv4 server SAN is supported; use --dns for IPv6 hosts");
    san = [der(0x82, Buffer.from(dns, "ascii")), der(0x87, ipBytes)];
  } else {
    san = [der(0x86, Buffer.from(`urn:nexo:reader:${readerId}`, "ascii"))];
  }
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const cert = certificate({
    subject: isServer ? "nexo-coordinator" : `nexo-reader:${readerId}`,
    issuer: "NEXO laboratory CA", publicKey: pair.publicKey, signingKey: caKey,
    san, usage: isServer ? "1.3.6.1.5.5.7.3.1" : "1.3.6.1.5.5.7.3.2", days: 30,
  });
  const x509 = new X509Certificate(cert);
  if (x509.ca || !x509.verify(ca.publicKey) || !x509.checkPrivateKey(pair.privateKey)) {
    throw new Error("Generated credential is invalid");
  }
  mkdirSync(directory);
  writeNew(path.join(directory, "tls.key"), pair.privateKey.export({ type: "pkcs8", format: "pem" }), 0o600);
  writeNew(path.join(directory, "tls.crt"), cert, 0o644);
  console.log(`${isServer ? "Coordinator" : `Reader ${readerId}`} credential issued in ${directory} (serial ${x509.serialNumber})`);
}

function readerCertificate(root, readerId, ca) {
  const cert = new X509Certificate(readFileSync(path.join(root, "readers", readerId, "tls.crt")));
  if (!cert.verify(ca.publicKey) || cert.ca ||
      cert.subject !== `CN=nexo-reader:${readerId}` ||
      cert.subjectAltName !== `URI:urn:nexo:reader:${readerId}`) {
    throw new Error(`Invalid certificate identity or issuer for reader ${readerId}`);
  }
  return cert;
}

function revoke(root, readerId, reason) {
  if (!["lost", "compromised", "retired"].includes(reason)) throw new Error("Invalid revocation reason");
  const { ca } = loadCa(root);
  const cert = readerCertificate(root, readerId, ca);
  const lock = path.join(root, "revoked.lock");
  const fd = openSync(lock, "wx", 0o600);
  try {
    const list = loadRevocations(root, ca);
    if (list.revoked.some((entry) => entry.readerId === readerId || entry.serialNumber === cert.serialNumber ||
        entry.fingerprint256 === fingerprint(cert))) {
      console.log(`Reader ${readerId} already revoked`);
      return;
    }
    list.revoked.push({
      readerId, serialNumber: cert.serialNumber, fingerprint256: fingerprint(cert),
      revokedAt: new Date().toISOString(), reason,
    });
    const replacement = path.join(root, "revoked.next");
    writeNew(replacement, JSON.stringify(list, null, 2) + "\n", 0o600);
    renameSync(replacement, path.join(root, "revoked.json"));
    console.log(`Reader ${readerId} revoked (serial ${cert.serialNumber})`);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

function status(root, readerId) {
  const { ca } = loadCa(root);
  const cert = readerCertificate(root, readerId, ca);
  const list = loadRevocations(root, ca);
  const entry = list.revoked.find((item) => item.serialNumber === cert.serialNumber ||
    item.fingerprint256 === fingerprint(cert));
  console.log(JSON.stringify({
    readerId, serialNumber: cert.serialNumber, fingerprint256: fingerprint(cert),
    validTo: cert.validTo, revoked: Boolean(entry),
    ...(entry ? { revokedAt: entry.revokedAt, reason: entry.reason } : {}),
  }, null, 2));
}

try {
  const { command, options, root } = parseArgs(process.argv.slice(2));
  ensureDirectory(privateRoot);
  ensureDirectory(root);
  if (command === "init") init(root);
  else if (command === "issue-reader") issue(root, options["--reader-id"], options);
  else if (command === "issue-server") issue(root, null, options);
  else if (command === "revoke") revoke(root, options["--reader-id"], options["--reason"] ?? "lost");
  else status(root, options["--reader-id"]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
