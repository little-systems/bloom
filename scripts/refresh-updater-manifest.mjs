/**
 * Rewrites a Tauri updater manifest with signatures created after Authenticode
 * signing.
 *
 * Authenticode changes the installer bytes, so the `.sig` files and `latest.json`
 * produced by `tauri build` are stale once SignPath returns the signed
 * installers. Re-sign each signed installer with `tauri signer sign`, then run
 * this script to copy those signatures into the manifest.
 *
 * Usage:
 *   bun scripts/refresh-updater-manifest.mjs --manifest latest.json --assets signed/
 *
 * The manifest is written as UTF-8 without a BOM: the Tauri updater rejects a
 * BOM with a JSON decoding error.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);

function argValue(name) {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		console.error(`Missing value for ${name}`);
		process.exit(1);
	}
	return value;
}

const manifestPath = argValue("--manifest") ?? "latest.json";
const assetsDir = argValue("--assets") ?? "signed";

/** @type {{ platforms?: Record<string, { url?: string, signature?: string }> }} */
let manifest;
try {
	manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
	console.error(`Could not read ${manifestPath}: ${error.message}`);
	process.exit(1);
}

if (!manifest.platforms || typeof manifest.platforms !== "object") {
	console.error(`${manifestPath} has no platforms object`);
	process.exit(1);
}

const missing = [];
let updated = 0;

for (const [platform, entry] of Object.entries(manifest.platforms)) {
	if (!entry.url) {
		missing.push(`${platform}: no url`);
		continue;
	}

	let fileName;
	try {
		fileName = decodeURIComponent(new URL(entry.url).pathname.split("/").pop() ?? "");
	} catch {
		missing.push(`${platform}: invalid url ${entry.url}`);
		continue;
	}

	if (!fileName) {
		missing.push(`${platform}: no filename in url`);
		continue;
	}

	const signaturePath = join(assetsDir, `${fileName}.sig`);
	if (!existsSync(signaturePath)) {
		missing.push(`${platform}: ${signaturePath}`);
		continue;
	}

	const signature = readFileSync(signaturePath, "utf8").trim();
	if (!signature) {
		missing.push(`${platform}: ${signaturePath} is empty`);
		continue;
	}

	entry.signature = signature;
	updated += 1;
}

if (missing.length > 0) {
	console.error("Missing or invalid signatures:");
	for (const item of missing) console.error(`  - ${item}`);
	process.exit(1);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Updated ${updated} platform signature(s) in ${manifestPath}`);
