const assert = require('node:assert/strict');
const test = require('node:test');

const { getActiveApps } = require('.');

test('the application catalogue stays relative to the browser origin', async () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://wrong.example.invalid';

  try {
    const apps = await getActiveApps();
    assert.ok(apps.length > 0);
    const nativeViews = apps.filter((app) => app.native === true && typeof app.url === 'string');
    assert.ok(nativeViews.length > 0);
    for (const app of nativeViews) {
      assert.match(app.url, /^\/view\//);
      assert.equal(app.id, `external:${app.url}`);
    }
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});
