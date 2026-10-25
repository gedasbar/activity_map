// Optional, slow (a full test run per mutation): weakens one security rule at a time and checks that the test suite
// notices. A mutation that SURVIVES means a rule is either untested or redundant with another rule.
//
//   npm run mutation-check          all mutations
//   npm run mutation-check -- M3    just one (M1 ... M12)
//
// Known and expected: M7 and M8 survive because a second rule enforces the same thing (defence in depth).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(path.join(here, '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

const MUTATIONS = {
  M1: ['join without the invite check', '        && inviteRedeemedByCaller(coupleId, request.resource.data.joinCode);', '        && true;'],
  M2: ['mark an invite used without joining', '        && willBeMember(resource.data.coupleId);\n\n      // The creator', '        && true;\n\n      // The creator'],
  M3: ['everyone is a member of every couple', '        && request.auth.uid in get(couplePath(coupleId)).data.members;\n    }\n\n    // Same check', '        && true;\n    }\n\n    // Same check'],
  M4: ['couple id length not checked', '        && coupleId.size() == 20\n', ''],
  M5: ['users can set any coupleId', '            || validCoupleIdForUser(request.resource.data));', '            || true);'],
  M6: ['any photo url', "                && d.photoUrls[0].matches('https://res[.]cloudinary[.]com/jpxtr4kd/.*')))", '                && true))'],
  M7: ['couples can exceed two members (redundant check)', '        && resource.data.members.size() == 1\n', ''],
  M8: ['expired invites accepted on join (redundant check)', '        && get(invite).data.expiresAt > request.time.toMillis()\n', ''],
  M9: ['any signed-in user reads any profile', "      allow read: if signedIn()\n        && (request.auth.uid == userId\n            || (resource != null && isMember(resource.data.get('coupleId', null))));", '      allow read: if signedIn();'],
  M10: ['memories created into any couple', '      allow create: if isMember(request.resource.data.coupleId) && validLog(request.resource.data);', '      allow create: if signedIn() && validLog(request.resource.data);'],
  M11: ['places editable beyond the rating', "        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['rating'])\n", ''],
  M12: ['anyone can list invites', '      allow list: if false;\n\n      allow create: if signedIn()\n        && code.matches', '      allow list: if signedIn();\n\n      allow create: if signedIn()\n        && code.matches'],
};

const only = process.argv[2];
const dir = mkdtempSync(path.join(tmpdir(), 'rules-mutation-'));
let surprises = 0;

for (const [id, [name, from, to]] of Object.entries(MUTATIONS)) {
  if (only && only !== id) continue;
  if (!rules.includes(from)) { console.log(`${id} ${name}: PATTERN NOT FOUND (the rules changed; update this script)`); surprises++; continue; }
  const file = path.join(dir, `${id}.rules`);
  writeFileSync(file, rules.replace(from, to));
  const r = spawnSync('npm test', { cwd: here, env: { ...process.env, RULES_FILE: file }, shell: true, encoding: 'utf8' });
  const failing = Number(((r.stdout + r.stderr).match(/ℹ fail (\d+)/) ?? [])[1] ?? NaN);
  const redundant = id === 'M7' || id === 'M8';
  const caught = failing > 0;
  console.log(`${id} ${name}: ${Number.isNaN(failing) ? 'NO RESULT' : caught ? `caught (${failing} failing)` : 'SURVIVED'}${redundant ? ' [expected: redundant check]' : ''}`);
  if (Number.isNaN(failing) || caught === redundant) surprises++;
}

console.log(surprises === 0 ? '\nAs expected.' : `\n${surprises} unexpected result(s).`);
process.exit(surprises === 0 ? 0 : 1);
