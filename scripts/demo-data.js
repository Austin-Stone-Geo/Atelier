// Fills a fresh database with a small sample project so you can click around.
// Usage: DB_PATH=./data/demo.db node scripts/demo-data.js   (then start the server with the same DB_PATH)
import * as core from '../src/core.js';
import * as auth from '../src/auth.js';

const austin = auth.signUp({ email: 'austin@demo.test', name: 'Austin', password: 'atelier-demo' });
const nick = auth.signUp({ email: 'nick@demo.test', name: 'Nick', password: 'atelier-demo' });
const client = auth.signUp({ email: 'client@demo.test', name: 'Dana (client)', password: 'atelier-demo' });
const A = (via = 'hand') => ({ userId: austin.id, via });
const N = (via = 'hand') => ({ userId: nick.id, via });

const p = core.createProject(A(), { name: 'Mountain hut design brief', goal: 'Agree a one-page design brief for the Indian Peaks backcountry hut with the client.' });
core.acceptInvite(N(), core.createInvite(A(), p.id, { email: 'nick@demo.test', role: 'editor' }).token);
core.acceptInvite({ userId: client.id, via: 'hand' }, core.createInvite(A(), p.id, { email: 'client@demo.test', role: 'commenter' }).token);

const a = core.postContribution(A('Claude'), p.id, { title: "Austin's brief draft", visibility: 'shared', body:
`# Design brief: Indian Peaks hut

## Purpose
A year-round, 12-bunk hut for ski tourers in winter and hikers in summer.

## Site
South-facing bench at 11,200 ft, sheltered from the prevailing west wind.

## Must haves
- Wood stove and passive solar gain
- Gear drying room
- Composting toilet

## Budget
To be confirmed.` });
const n = core.postContribution(N('ChatGPT'), p.id, { title: "Nick's brief draft", visibility: 'shared', body:
`# Hut brief

## Purpose
Backcountry hut sleeping 12, open all seasons.

## Must haves
- Avalanche-safe approach route in winter
- Solar PV with battery storage
- Snowmelt water system

## Budget
$480k including helicopter delivery of materials.` });
core.postContribution(N('ChatGPT'), p.id, { title: 'Nick scratch notes', visibility: 'private', body: 'Ask about the Forest Service permit timeline before we send this.' });

const v1 = core.propose(A('Claude'), p.id, { title: 'Design brief: Indian Peaks hut', contributionIds: [a.id, n.id], summary: "Merged Austin's site notes with Nick's systems list and budget.", body:
`# Design brief: Indian Peaks hut

## Purpose
A year-round, 12-bunk hut for ski tourers in winter and hikers in summer.

## Site
South-facing bench at 11,200 ft, sheltered from the prevailing west wind, with an avalanche-safe winter approach.

## Must haves
- Wood stove and passive solar gain
- Solar PV with battery storage
- Gear drying room
- Snowmelt water system and composting toilet

## Budget
$480k including helicopter delivery of materials.` });
core.postComment(N('ChatGPT'), { targetId: v1.id, body: 'Can we say who maintains the PV system?', quote: 'Solar PV with battery storage' });
core.review(N('ChatGPT'), v1.id, { decision: 'approve', comment: 'Good merge.' });
core.review({ userId: client.id, via: 'hand' }, v1.id, { decision: 'approve' });

const v2 = core.propose(N(), p.id, { title: 'Design brief: Indian Peaks hut', summary: 'Added maintenance and a schedule.', body:
  core.getVersion(N(), v1.id).body.replace('## Budget', '## Operations\nThe hut association maintains the PV and water systems each June.\n\n## Schedule\nPermits in 2027, build summer 2028.\n\n## Budget') });
core.review(A(), v2.id, { decision: 'approve' });
console.log(`Demo data ready. Sign in as austin@demo.test / nick@demo.test / client@demo.test, password "atelier-demo".`);
