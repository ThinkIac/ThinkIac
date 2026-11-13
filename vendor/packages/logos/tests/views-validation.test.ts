import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SvelteEngine } from '../../modules/svelte';

const temporary: string[] = [];

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

function fixture() {
  const workspace = temp('logos-views-workspace-');
  const cache = temp('logos-views-cache-');
  const views = path.join(workspace, 'pkg', 'views');
  fs.mkdirSync(views, { recursive: true });
  return { workspace, cache, views, engine: new SvelteEngine(cache) };
}

function write(views: string, page: string, source: string): string {
  const file = path.join(views, `${page}.svelte`);
  fs.writeFileSync(file, source);
  return file;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('view validation rollback', () => {
  it('preserves the last valid view after a syntax error and recovers after correction', async () => {
    const { workspace, views, engine } = fixture();
    const source = write(views, 'Home', '<p>stable</p>');
    expect(await engine.render(source, 'pkg__Home', {}, workspace)).toContain('stable');

    write(views, 'Home', '<script>let = ;</script>');
    await expect(engine.validateComponents(['pkg__Home'], workspace)).rejects.toThrow();
    expect(await engine.render(source, 'pkg__Home', {}, workspace)).toContain('stable');

    write(views, 'Home', '<p>recovered</p>');
    await engine.validateComponents(['pkg__Home'], workspace);
    expect(await engine.render(source, 'pkg__Home', {}, workspace)).toContain('recovered');
  });

  it('rolls back the whole sequential batch after an SSR runtime error', async () => {
    const { workspace, views, engine } = fixture();
    const first = write(views, 'First', '<p>first stable</p>');
    const second = write(views, 'Second', '<p>second stable</p>');
    const otherViews = path.join(workspace, 'other-pkg', 'views');
    fs.mkdirSync(otherViews, { recursive: true });
    const unaffected = write(otherViews, 'Other', '<p>other stable</p>');
    await engine.render(first, 'pkg__First', {}, workspace);
    await engine.render(second, 'pkg__Second', {}, workspace);
    await engine.render(unaffected, 'other-pkg__Other', {}, workspace);

    write(views, 'First', '<p>first candidate</p>');
    write(views, 'Second', `<script>const broken = JSON.parse('invalid')</script><p>{broken}</p>`);
    await expect(engine.validateComponents(['pkg__First', 'pkg__Second'], workspace))
      .rejects.toThrow(/JSON|Unexpected token/);

    expect(await engine.render(first, 'pkg__First', {}, workspace)).toContain('first stable');
    expect(await engine.render(second, 'pkg__Second', {}, workspace)).toContain('second stable');
    expect(await engine.render(unaffected, 'other-pkg__Other', {}, workspace)).toContain('other stable');
  });

  it('reports the first invalid build when no valid version exists', async () => {
    const { workspace, views, engine } = fixture();
    write(views, 'New', '<script>let = ;</script>');

    await expect(engine.validateComponents(['pkg__New'], workspace)).rejects.toThrow();
  });

  it('holds a concurrent render until a failed validation restores the stable build', async () => {
    const { workspace, views, engine } = fixture();
    const source = write(views, 'Home', '<p>stable during validation</p>');
    await engine.render(source, 'pkg__Home', {}, workspace);

    write(views, 'Home', `<script>const broken = JSON.parse('invalid')</script><p>{broken}</p>`);
    const originalCompile = (engine as any).compile.bind(engine);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const compiling = new Promise<void>((resolve) => { entered = resolve; });
    (engine as any).compile = async (...args: any[]) => {
      if (args[3] === false) {
        entered();
        await held;
      }
      return originalCompile(...args);
    };

    const validation = engine.validateComponents(['pkg__Home'], workspace);
    await compiling;
    let rendered = false;
    const concurrentRender = engine.render(source, 'pkg__Home', {}, workspace)
      .then((html) => { rendered = true; return html; });
    await Promise.resolve();
    expect(rendered).toBe(false);

    release();
    await expect(validation).rejects.toThrow(/JSON|Unexpected token/);
    await expect(concurrentRender).resolves.toContain('stable during validation');
  });

  it('serializes concurrent validation batches', async () => {
    const { workspace, views, engine } = fixture();
    write(views, 'First', '<p>first</p>');
    write(views, 'Second', '<p>second</p>');
    const originalCompile = (engine as any).compile.bind(engine);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
    let candidateCompiles = 0;
    (engine as any).compile = async (...args: any[]) => {
      if (args[3] === false) {
        candidateCompiles++;
        if (candidateCompiles === 1) {
          firstEntered();
          await held;
        }
      }
      return originalCompile(...args);
    };

    const first = engine.validateComponents(['pkg__First'], workspace);
    const second = engine.validateComponents(['pkg__Second'], workspace);
    await entered;
    await Promise.resolve();
    expect(candidateCompiles).toBe(1);

    release();
    await Promise.all([first, second]);
    expect(candidateCompiles).toBe(2);
  });
});
