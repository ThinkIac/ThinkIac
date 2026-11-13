import crypto from 'node:crypto';
const LEASE_MS = 5 * 60_000;

export function claimActivation(db, userId, now = Date.now()) {
    const table = db.user;
    const sql = table?._db;
    if (sql?.transaction) {
        return sql.transaction(() => {
            const name = '"' + table._modelName.replaceAll('"','""') + '"';
            const user = sql.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(userId);
            if (!user || user.tenantStatus === 'ready' || Number(user.activationLeaseUntil) > now) return null;
            const requestId = user.activationRequestId || crypto.randomUUID();
            const leaseId = crypto.randomUUID();
            sql.prepare(`UPDATE ${name} SET activationRequestId=?, activationLeaseId=?, activationLeaseUntil=?, tenantStatus='pending' WHERE id=?`).run(requestId, leaseId, now + LEASE_MS, userId);
            delete table._records[userId];
            return { requestId, leaseId };
        }).immediate();
    }
    const user = table[userId];
    if (!user || user.tenantStatus === 'ready' || Number(user.activationLeaseUntil) > now) return null;
    user.activationRequestId ||= crypto.randomUUID();
    user.activationLeaseId = crypto.randomUUID();
    user.activationLeaseUntil = now + LEASE_MS;
    user.tenantStatus = 'pending';
    return { requestId: user.activationRequestId, leaseId: user.activationLeaseId };
}

export function updateActivationLease(db, userId, leaseId, until) {
    const table = db.user;
    if (table?._db?.prepare) {
        const name = '"' + table._modelName.replaceAll('"','""') + '"';
        const result = table._db.prepare(`UPDATE ${name} SET activationLeaseUntil=? WHERE id=? AND activationLeaseId=?`).run(until, userId, leaseId);
        delete table._records[userId];
        return result.changes === 1;
    }
    if (table[userId]?.activationLeaseId !== leaseId) return false;
    table[userId].activationLeaseUntil = until;
    return true;
}

export async function recoverActivations(db, { provision = null, grant, now = Date.now(), limit = 10 }) {
    const users = await db.user.all();
    let resumed = 0;
    for (const snapshot of users || []) {
        const user = db.user[snapshot.id] || snapshot;
        if (user.emailVerified === true && user.welcomeCreditStatus !== 'granted') await grant(user.id);
        if (!provision || resumed >= limit || user.role === 'admin' || !user.username || user.tenantStatus == null || user.tenantStatus === 'ready') continue;
        if (Number(user.activationLeaseUntil) > now) continue;
        resumed++;
        await provision(user.id, user.username, { plan: 'free' });
    }
    return { resumed };
}
