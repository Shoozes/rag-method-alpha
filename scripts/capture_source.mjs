import { resolveBuildSource } from './public-source.mjs';
import { validateStaticArtifactDirectory } from '../modules/browser-rag-ts/scripts/static-artifact-common.mjs';

/** Reject stale builds and modified payloads before claiming screenshot provenance. */
export async function assertCaptureSource(root, site) {
  const manifest = await validateStaticArtifactDirectory(site);
  const current = resolveBuildSource(root);
  if (JSON.stringify(current) !== JSON.stringify(manifest.source)) {
    throw new Error('Atlas capture source differs from the built artifact. Run node run.mjs build-browser first.');
  }
  return Object.freeze({ ...current, artifact_identity_sha256: manifest.artifact.identity_sha256 });
}
