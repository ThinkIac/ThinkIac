const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const GITHUB_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'codeload.github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function parseGitHubPackage(identifier) {
  const match = /^(?:git:([A-Za-z0-9][A-Za-z0-9-]{0,38})\/)?([A-Za-z0-9_][A-Za-z0-9._-]{0,99})$/.exec(
    typeof identifier === 'string' ? identifier.trim() : '',
  );
  if (!match) throw new Error('Use a package name or git:owner/package');
  return { owner: match[1] || 'ThinkIac', name: match[2] };
}

export async function downloadGitHubPackage(identifier, fetchPackage = fetch) {
  const { owner, name } = parseGitHubPackage(identifier);
  const repo = `${owner}/${name}`;
  const signal = AbortSignal.timeout(60_000);
  const latest = await fetchPackage(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    redirect: 'error',
    signal,
  });

  let filename = `${name}-HEAD.zip`;
  let source = 'default branch';
  let url = new URL(`https://codeload.github.com/${repo}/zip/HEAD`);
  if (latest.ok) {
    const release = await latest.json();
    const tag = release.tag_name;
    filename = `package-${tag}.zip`;
    if (typeof tag !== 'string' || !/^v[\w.+-]+$/.test(tag)
      || !release.assets?.some(asset => asset.name === filename && asset.state === 'uploaded')) {
      throw new Error(`Release ${tag} of ${repo} has no Engineer package ZIP`);
    }
    source = `release ${tag}`;
    url = new URL(`https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`);
  } else {
    await latest.body?.cancel();
    if (latest.status !== 404) throw new Error(`Could not resolve the latest release of ${repo} (HTTP ${latest.status})`);
  }

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !GITHUB_DOWNLOAD_HOSTS.has(url.hostname)) {
      throw new Error('GitHub package download redirected to an unsupported destination');
    }
    const response = await fetchPackage(url, { redirect: 'manual', signal });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('GitHub package download redirected without a destination');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Could not download ${repo} from its ${source} (HTTP ${response.status})`);
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_ARCHIVE_BYTES) throw new Error('GitHub package ZIP exceeds 50 MiB');
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks, bytes), filename, origin: `${repo} (${source})` };
  }
  throw new Error('GitHub package download exceeded the redirect limit');
}
