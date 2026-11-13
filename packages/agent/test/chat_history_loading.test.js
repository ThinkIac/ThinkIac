import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [home, sessions] = await Promise.all([
    readFile(new URL("../views/Home.svelte", import.meta.url), "utf8"),
    readFile(new URL("../routes/sessions.js", import.meta.url), "utf8"),
]);




assert.match(home, /let sessionActivation = 0;/);
assert.match(home, /const activation = \+\+sessionActivation;/);
assert.match(home, /if \(activation !== sessionActivation \|\| sessionId !== sid\) return;/);
assert.match(home, /function historyPath\(sid\).*limit=all/s);
assert.match(home, /api\(historyPath\(sid\), "GET"\)/);
assert.match(home, /activateSession\(newId, newHistory\)/);
assert.match(home, /const data = prefetchedHistory \?\? await api\(historyPath\(sid\), "GET"\)/);



assert.match(home, /if \(loadedHistory\.length > 0\) sessionCache\[sid\] = loadedHistory;/);
assert.match(home, /else delete sessionCache\[sid\];/);



assert.match(home, /if \(refreshed\.length > 0\) sessionCache\[sid\] = refreshed;/);



assert.doesNotMatch(home, /\.chat-panel::before/);



assert.match(sessions, /requestedLimit === "all"/);
assert.match(sessions, /return limit === null \? filtered : filtered\.slice\(-limit\);/);




assert.match(sessions, /Array\.isArray\(m\.tool_calls\)/);
assert.match(sessions, /m\.tool_calls\.length === 0/);
assert.doesNotMatch(sessions, /assistant' && !m\.content\) return false/);

console.log("chat history loading: ok");
