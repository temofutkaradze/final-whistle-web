import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {markerIsValid,sourceFingerprint} from '../scripts/production-build-guard.mjs';
it('accepts only a successful marker for the exact current build and source fingerprint',()=>{
  const current={buildId:'build-1',fingerprint:'sha256-current'};
  expect(markerIsValid({state:'success',completedAt:new Date().toISOString(),buildId:current.buildId,sourceFingerprint:current.fingerprint},current)).toBe(true);
  for(const marker of [null,{}, {state:'building',...current}, {state:'success',...current,buildId:'old'}, {state:'success',...current,sourceFingerprint:'stale'}])expect(markerIsValid(marker,current)).toBe(false);
});
it('keeps the production launcher gated before its first service command',()=>{
  const launcher=readFileSync('start-system-production.bat','utf8'),build=JSON.parse(readFileSync('package.json','utf8'));
  expect(build.scripts.prebuild).toContain('begin');expect(build.scripts.postbuild).toContain('finish');
  expect(launcher.indexOf('production-build-guard.mjs verify')).toBeGreaterThanOrEqual(0);
  expect(launcher.indexOf('production-build-guard.mjs verify')).toBeLessThan(launcher.indexOf('wt -w 0'));
  expect(launcher).toContain('npm run start');
});
it('computes a stable source fingerprint without modifying source files',()=>{
  expect(sourceFingerprint()).toMatch(/^[a-f0-9]{64}$/);
  expect(sourceFingerprint()).toBe(sourceFingerprint());
});
