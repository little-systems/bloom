# SignPath signing

Bloom's Windows installers are Authenticode-signed by [SignPath](https://signpath.io)
through the SignPath Foundation program.

## Why signing happens after the build

Tauri's `bundle.windows.signCommand` runs once per binary, including the NSIS
plugin DLLs, and it runs before the GitHub artifact exists. SignPath's
open-source program verifies that the signed bytes came from a GitHub Actions
artifact, so signing has to happen as a separate step after the bundle is built:

1. `bun run tauri build` produces unsigned installers.
2. The installers are uploaded as a GitHub Actions artifact (a ZIP).
3. SignPath signs every file described by `artifact-configuration.xml`.
4. The signed ZIP is downloaded and verified.

Consequence: post-build Authenticode changes the installer bytes, so Tauri's
updater `.sig` files and `latest.json` must be regenerated after signing. The
test workflow does not create updater artifacts, so it does not have to deal
with this yet. The release workflow will.

The inner application executable inside the NSIS installer stays unsigned.
NSIS is a compressed container, so SignPath cannot deep-sign it. Signing the
installer is what clears the download/SmartScreen warning; the installed app
runs without Mark-of-the-Web. The MSI could be deep-signed later if Smart App
Control coverage becomes a requirement.

## First-time setup

Per the [GitHub trusted build system prerequisites](https://docs.signpath.io/trusted-build-systems/github#prerequisites):

SignPath normally pre-creates the project, a `test-signing` policy, an invalid
`release-signing` policy awaiting the production certificate, and an
`Initial version` artifact configuration. Inspect those first and edit them
instead of adding duplicates; keep the policy slugs `test-signing` and
`release-signing` because the workflows refer to them by name.

1. Add the predefined **GitHub.com** trusted build system to the SignPath
   organization and link it to the project.
2. Install the [SignPath GitHub App](https://github.com/apps/signpath) for the
   `little-systems/bloom` repository. This is required when SignPath evaluates
   GitHub audit logs (SCM policies with `enforced_from`); it is recommended even
   when no SCM policy is configured.
3. Verify the project repository URL is `https://github.com/little-systems/bloom`.
   If the repository was transferred, this must be updated: GitHub redirects the
   old URL for browsers, but the connector reports the new one and origin
   verification compares against the project setting exactly.
4. Replace or add the artifact configuration from a sample ZIP containing the
   current release installers at its root:

   ```powershell
   $dir = "bloom-signing-sample"
   gh release download v3.10.2 --dir $dir `
     --pattern "*x64-setup.exe" --pattern "*x64_en-US.msi"
   Compress-Archive -Path "$dir\*" -DestinationPath bloom-signing-sample.zip
   ```

   Upload that ZIP in SignPath, then replace the generated XML with
   `artifact-configuration.xml` (or paste it) and confirm the resolved view
   shows both files. SignPath auto-generates a slug from the name (for example
   `Windows_Installers`); keep it and pass it as `artifact_configuration_slug`
   if it differs from the workflow default.
5. Confirm the **`test-signing`** policy (purpose: *test*) uses the provided
   self-signed certificate. Enable **trusted build system verification** for
   GitHub.com, enable **origin verification** with `main` as the allowed branch,
   and add the CI user as a *Submitter*. Leave the pre-created
   `release-signing` policy invalid until the production certificate arrives.
6. Create an API token for the CI user (with submitter permission on the
   project) and add it to the repository as the `SIGNPATH_API_TOKEN` secret.

The open-source program requires every job leading up to the signing request to
run on a GitHub-hosted runner. The workflow uses `windows-latest` for that
reason; do not move the build to a self-hosted runner.

## Running the test

Run the **Sign (test)** workflow manually with the organization ID and slugs
from SignPath. It builds, signs, verifies the signatures, and exposes
`bloom-signed-installers` as a workflow artifact. Nothing is published.

`Get-AuthenticodeSignature` reports `UnknownError` or `NotTrusted` for the
self-signed test certificate; the check only requires a signer certificate to
be present.

## Enabling it for releases

After SignPath has imported the production certificate:

1. Create a `release-signing` policy (purpose: *release*) with the production
   certificate and the same trusted-build-system and origin-verification rules.
2. Change `release.yml` to build into a **draft** release, sign the installers,
   replace the assets, verify, and only then publish.
3. Regenerate the Tauri updater signatures, because Authenticode changes the
   installer bytes. From the directory containing the signed installers and the
   `latest.json` produced by the build:

   ```bash
   VERSION="x.y.z"
   for file in signed/*.exe signed/*.msi; do
     bun run tauri signer sign --app-version "$VERSION" "$file"
   done
   bun scripts/refresh-updater-manifest.mjs --manifest latest.json --assets signed
   ```

   `refresh-updater-manifest.mjs` replaces the signature of every platform entry
   in `latest.json` with the matching `<file>.sig`, writes UTF-8 without a BOM,
   and fails if any signature is missing. It has been dry-run against the live
   v3.10.2 manifest.
4. Confirm `bun scripts/verify-updater.mjs vX.Y.Z` passes, then publish the
   draft.
