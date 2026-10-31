// Runs in Capacitor's headless JS engine on the phone, also while the app is closed.
// Android wakes it about every 15 minutes (the OS decides exactly when).

var TITLES = {
  brief: 'Morning brief',
  report: 'Evening report',
  followup: 'Follow-up',
  check: 'Check-in',
  done: 'Task finished',
  chat: 'Duet replied',
};

function read(key) {
  try {
    var v = CapacitorKV.get(key);
    if (v && typeof v === 'object') v = v.value;
    return v || null;
  } catch (e) {
    return null;
  }
}

// Notification ids must be 32-bit ints; derive a stable one from the message id.
function idFor(uuid) {
  var h = 0;
  for (var i = 0; i < uuid.length; i++) h = (h * 31 + uuid.charCodeAt(i)) | 0;
  return h;
}

function firstLine(text) {
  var line = String(text || '')
    .split('\n')
    .map(function (l) {
      return l.replace(/^\s*[-*#>\d.)]+\s*/, '').replace(/[`*_]/g, '').trim();
    })
    .filter(Boolean)[0];
  return (line || '').slice(0, 180);
}

addEventListener('configure', function (resolve, reject, args) {
  try {
    if (args && args.url && args.token) CapacitorKV.set('connection', JSON.stringify({ url: args.url, token: args.token }));
    else CapacitorKV.remove('connection');
    if (args && args.seenTs) CapacitorKV.set('seenTs', String(args.seenTs));
    resolve();
  } catch (err) {
    reject(err);
  }
});

addEventListener('seen', function (resolve, reject, args) {
  try {
    if (args && args.seenTs > Number(read('seenTs') || 0)) CapacitorKV.set('seenTs', String(args.seenTs));
    resolve();
  } catch (err) {
    reject(err);
  }
});

addEventListener('check', async function (resolve, reject) {
  try {
    var raw = read('connection');
    if (!raw) {
      console.log('duet check: not paired');
      return resolve();
    }
    var conn = JSON.parse(raw);
    // The runner's fetch is not the browser's: it requires an explicit method.
    var res = await fetch(conn.url + '/api/state', { method: 'GET', headers: { authorization: 'Bearer ' + conn.token } });
    console.log('duet check: state ' + res.status);
    if (!res.ok) return resolve();
    var state = await res.json();

    var seen = Number(read('seenTs') || 0);
    var fresh = state.messages.filter(function (m) {
      return m.role === 'duet' && m.ts > seen;
    });
    console.log('duet check: ' + fresh.length + ' new since ' + seen);
    if (!fresh.length) return resolve();
    CapacitorKV.set('seenTs', String(Math.max.apply(null, fresh.map(function (m) { return m.ts; }))));

    var notes = fresh.slice(-5).map(function (m) {
      var pending = m.proposal && m.proposal.status === 'pending';
      return {
        id: idFor(m.id),
        title: pending ? 'Duet needs your approval' : TITLES[m.kind] || 'Duet',
        body: pending ? firstLine(m.proposal.actions) : firstLine(m.text),
        autoCancel: true,
      };
    });
    CapacitorNotifications.schedule(notes);
    console.log('duet check: notified ' + notes.length);
    resolve();
  } catch (err) {
    console.error('duet check failed: ' + (err && err.message ? err.message : err));
    reject(err);
  }
});
