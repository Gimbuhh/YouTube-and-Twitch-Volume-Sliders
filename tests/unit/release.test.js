import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOnlyExpectedNewChanges, restoreReleaseState, snapshotFiles } from '../../scripts/release.mjs';

test('release status validation allows only declared new outputs',()=>{
  const before=' M src/shared/options.js\n?? release-notes/2.4.2.md\n';
  const expected=before+' M package.json\n M dist/youtube-volume-slider.user.js\n?? archive/releases/2.4.2/\n';
  assert.doesNotThrow(()=>assertOnlyExpectedNewChanges(before,expected,'2.4.2'));
  assert.throws(()=>assertOnlyExpectedNewChanges(before,expected+'?? debug-output.txt\n','2.4.2'),/debug-output\.txt/);
});

test('release rollback restores exact files and removes only the new destination',async()=>{
  const root=await mkdtemp(join(tmpdir(),'volume-release-test-'));
  const first=join(root,'first.txt');
  const missing=join(root,'missing.txt');
  const destination=join(root,'archive','2.4.2');
  await writeFile(first,'before\r\n','utf8');
  const snapshots=await snapshotFiles([first,missing]);
  await writeFile(first,'after\n','utf8');
  await writeFile(missing,'created\n','utf8');
  await mkdir(destination,{recursive:true});
  await writeFile(join(destination,'artifact.txt'),'artifact','utf8');

  await restoreReleaseState(snapshots,destination);
  assert.equal(await readFile(first,'utf8'),'before\r\n');
  await assert.rejects(readFile(missing),error=>error.code==='ENOENT');
  await assert.rejects(readFile(join(destination,'artifact.txt')),error=>error.code==='ENOENT');
  await rm(root,{recursive:true,force:true});
});
