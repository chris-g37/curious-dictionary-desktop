// Offline pack installer: reads the published manifest, downloads a pack,
// verifies it, and installs it without ever touching a working pack until
// the new one has been fully checked.
//
//   manifest -> download .gz to a temp file (hash while writing) -> check
//   SHA-256 + size -> gunzip to a second temp file (hash again) -> check ->
//   open it once as a sanity check -> rename over <packs>/<id>.db
//
// Everything is streamed, so a 80 MB pack never sits in memory. Only https
// URLs on an allowlist are followed, and the file name on disk comes from the
// validated pack id, never from the URL.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { DatabaseSync } = require("node:sqlite");

const MANIFEST_URL =
  "https://github.com/chris-g37/curious-dictionary-desktop/releases/download/packs/manifest.json";

// github.com serves the release URL; it redirects the actual bytes to
// release-assets.githubusercontent.com (observed from a real download).
const DOWNLOAD_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com"]);

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_PACK_BYTES = 2 * 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const TEMP_SUFFIXES = [".part", ".tmp"];

class InstallError extends Error {}

function isAllowedUrl(url, hosts = DOWNLOAD_HOSTS) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && hosts.has(u.hostname);
  } catch (err) {
    return false;
  }
}

function validateManifest(data, hosts) {
  if (!data || data.schema !== 1 || !Array.isArray(data.packs)) {
    throw new InstallError("The pack list has an unexpected format.");
  }
  const hex64 = /^[0-9a-f]{64}$/;
  const packs = [];
  for (const p of data.packs) {
    const ok =
      p &&
      /^curious-[a-z]{2,3}-(core|full)$/.test(p.id) &&
      p.id === `curious-${p.language}-${p.profile}` &&
      /^\d{4}\.\d{2}\.\d{2}$/.test(p.version) &&
      Number.isFinite(p.size_bytes) && p.size_bytes > 0 && p.size_bytes < MAX_PACK_BYTES &&
      Number.isFinite(p.download_bytes) && p.download_bytes > 0 && p.download_bytes < MAX_PACK_BYTES &&
      hex64.test(p.sha256) &&
      hex64.test(p.sha256_gz) &&
      isAllowedUrl(p.url, hosts);
    if (ok) packs.push(p);
  }
  return packs;
}

function createInstaller({ getPackDir, pack, store, onProgress = () => {}, fetchFn = fetch, hosts = DOWNLOAD_HOSTS, manifestUrl = MANIFEST_URL }) {
  let manifestCache = null; // { at, packs }
  let current = null; // { id, controller }
  let state = { status: "idle" }; // idle | downloading | verifying | installing

  const setState = (next) => {
    state = next;
    onProgress(state);
  };

  // GET with manual redirect handling so every hop is checked against the allowlist.
  async function get(url, signal) {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedUrl(target, hosts)) throw new InstallError("Blocked a download from an unexpected address.");
      let res;
      try {
        res = await fetchFn(target, { redirect: "manual", signal });
      } catch (err) {
        if (err.name === "AbortError") throw err;
        throw new InstallError("Couldn't reach the download server. Check your connection.");
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new InstallError("The download server sent a bad redirect.");
        target = new URL(loc, target).toString();
        continue;
      }
      if (!res.ok) throw new InstallError(`The download server returned an error (${res.status}).`);
      return res;
    }
    throw new InstallError("Too many redirects.");
  }

  async function getManifest({ force = false } = {}) {
    if (!force && manifestCache && Date.now() - manifestCache.at < 60 * 60 * 1000) return manifestCache.packs;
    const res = await get(manifestUrl, undefined);
    const chunks = [];
    let size = 0;
    for await (const chunk of Readable.fromWeb(res.body)) {
      size += chunk.length;
      if (size > MAX_MANIFEST_BYTES) throw new InstallError("The pack list is unexpectedly large.");
      chunks.push(chunk);
    }
    let json;
    try {
      json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (err) {
      throw new InstallError("The pack list could not be read.");
    }
    const packs = validateManifest(json, hosts).filter((p) => p.language === "en");
    manifestCache = { at: Date.now(), packs };
    return packs;
  }

  // ---- update check (at most once a day, never downloads) -------------------

  function installedVersion() {
    const info = pack.info();
    return info ? { id: `curious-${info.language}-${info.profile}`, version: info.version } : null;
  }

  function storedUpdate() {
    const saved = store.get("packCheck") || {};
    const inst = installedVersion();
    const latest = inst && saved.latest ? saved.latest[inst.id] : null;
    return inst && latest && latest > inst.version ? { id: inst.id, version: latest } : null;
  }

  async function checkForUpdate({ force = false } = {}) {
    const inst = installedVersion();
    if (!inst) return null;
    const saved = store.get("packCheck") || {};
    if (!force && saved.checkedAt && Date.now() - saved.checkedAt < DAY_MS) return storedUpdate();
    try {
      const packs = await getManifest({ force: true });
      const latest = {};
      for (const p of packs) latest[p.id] = p.version;
      store.set("packCheck", { checkedAt: Date.now(), latest });
    } catch (err) {
      // Quiet by design: no network just means no update notice today.
    }
    return storedUpdate();
  }

  // ---- install ----------------------------------------------------------------

  function tempPath(dir, id, suffix) {
    return path.join(dir, `.${id}${suffix}`);
  }

  function cleanupStale() {
    try {
      const dir = getPackDir();
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(".") && TEMP_SUFFIXES.some((s) => name.endsWith(s))) {
          fs.rmSync(path.join(dir, name), { force: true });
        }
      }
    } catch (err) {
      // No packs folder yet; nothing to clean.
    }
  }

  // Transform that hashes and counts bytes passing through, optionally capped.
  function meter(hash, onBytes, maxBytes) {
    let total = 0;
    return new Transform({
      transform(chunk, enc, cb) {
        total += chunk.length;
        if (maxBytes && total > maxBytes) return cb(new InstallError("The pack is larger than expected."));
        hash.update(chunk);
        onBytes(total);
        cb(null, chunk);
      },
    });
  }

  async function download(profile) {
    if (current) return { ok: false, error: "A download is already running." };
    let entry;
    try {
      const packs = await getManifest({ force: true });
      entry = packs.find((p) => p.profile === profile);
      if (!entry) throw new InstallError("That pack isn’t available right now.");
    } catch (err) {
      return { ok: false, error: err instanceof InstallError ? err.message : "Couldn’t fetch the pack list." };
    }

    const dir = getPackDir();
    const part = tempPath(dir, entry.id, ".part");
    const tmp = tempPath(dir, entry.id, ".tmp");
    const finalFile = path.join(dir, `${entry.id}.db`);
    const controller = new AbortController();
    current = { id: entry.id, controller };
    let lastEmit = 0;

    try {
      fs.mkdirSync(dir, { recursive: true });
      cleanupStale();

      // 1. Download, hashing as we write.
      setState({ status: "downloading", id: entry.id, received: 0, total: entry.download_bytes });
      const res = await get(entry.url, controller.signal);
      const gzHash = crypto.createHash("sha256");
      await pipeline(
        Readable.fromWeb(res.body),
        meter(
          gzHash,
          (n) => {
            const now = Date.now();
            if (now - lastEmit > 120) {
              lastEmit = now;
              setState({ status: "downloading", id: entry.id, received: n, total: entry.download_bytes });
            }
          },
          entry.download_bytes
        ),
        fs.createWriteStream(part),
        { signal: controller.signal }
      );
      if (fs.statSync(part).size !== entry.download_bytes || gzHash.digest("hex") !== entry.sha256_gz) {
        throw new InstallError("The download didn’t match its checksum, so it was discarded. Please try again.");
      }

      // 2. Unpack to a second temp file, hashing again.
      setState({ status: "verifying", id: entry.id });
      const dbHash = crypto.createHash("sha256");
      await pipeline(
        fs.createReadStream(part),
        zlib.createGunzip(),
        meter(dbHash, () => {}, entry.size_bytes),
        fs.createWriteStream(tmp),
        { signal: controller.signal }
      );
      if (fs.statSync(tmp).size !== entry.size_bytes || dbHash.digest("hex") !== entry.sha256) {
        throw new InstallError("The unpacked pack didn’t match its checksum, so it was discarded. Please try again.");
      }

      // 3. It has to open as a real pack and say it is the pack we asked for.
      const probe = new DatabaseSync(tmp, { readOnly: true });
      try {
        const meta = {};
        for (const r of probe.prepare("SELECT key, value FROM meta").all()) meta[r.key] = r.value;
        probe.prepare("SELECT 1 FROM entries LIMIT 1").get();
        if (meta.pack_id !== entry.id || meta.version !== entry.version) {
          throw new InstallError("The pack didn’t identify itself correctly, so it was discarded.");
        }
      } finally {
        probe.close();
      }

      // 4. Install. Release our read handle first (Windows won't replace an
      // open file), then rename over the old pack; only then drop the other
      // profile so exactly one English pack remains.
      setState({ status: "installing", id: entry.id });
      pack.close();
      fs.renameSync(tmp, finalFile);
      for (const other of ["curious-en-core.db", "curious-en-full.db"]) {
        if (other !== path.basename(finalFile)) fs.rmSync(path.join(dir, other), { force: true });
      }
      fs.rmSync(part, { force: true });
      store.set("packCheck", { checkedAt: Date.now(), latest: { [entry.id]: entry.version } });
      setState({ status: "idle" });
      return { ok: true, id: entry.id, version: entry.version };
    } catch (err) {
      fs.rmSync(part, { force: true });
      fs.rmSync(tmp, { force: true });
      setState({ status: "idle" });
      if (controller.signal.aborted || err.name === "AbortError") return { ok: false, cancelled: true, error: "Download cancelled." };
      if (err instanceof InstallError) return { ok: false, error: err.message };
      if (err.code === "ENOSPC") return { ok: false, error: "Not enough free disk space for the pack." };
      if (err.code === "EBUSY" || err.code === "EPERM") return { ok: false, error: "Couldn’t replace the pack file because it is in use. Close other windows and try again." };
      return { ok: false, error: "The download failed. Please try again." };
    } finally {
      current = null;
    }
  }

  function cancel() {
    if (current) current.controller.abort();
  }

  return {
    getManifest,
    checkForUpdate,
    storedUpdate,
    download,
    cancel,
    cleanupStale,
    getState: () => state,
    isBusy: () => current !== null,
  };
}

module.exports = { createInstaller, validateManifest, isAllowedUrl, MANIFEST_URL, DOWNLOAD_HOSTS, InstallError };
