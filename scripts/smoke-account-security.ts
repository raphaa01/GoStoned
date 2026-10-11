import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { query, getPool, closePool } from "../lib/db";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { isUnambiguousLocalDatabase, getDatabaseUrl } from "../lib/env";
import { authenticateAccount, loginRateLimitSubject, registerAccount } from "../lib/auth/accountService";
import { completeAccountEmail } from "../lib/auth/accountEmailService";
import { createSession, getSessionUser } from "../lib/auth/session";
import { requestPasswordReset, resetAccountPassword } from "../lib/auth/passwordResetService";
import { assertAccountEmailComplete } from "../lib/auth/requestAuth";

async function run() {
  assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()), "Account security smoke is local-only.");
  await assertSmokeDatabaseIdentity(getPool());
  let id: string = randomUUID();
  const socialId = randomUUID();
  const username = `security_${id.replaceAll("-", "").slice(0, 10)}`;
  const email = `${username}@example.test`;
  const password = randomUUID();
  const nextPassword = randomUUID();
  try {
    const created = await registerAccount(username, password, null);
    id = created.user.id;
    assert.equal(created.user.emailRequired, true);
    const legacy = await authenticateAccount(username, password);
    assert.equal(legacy.emailRequired, true);
    const session = await createSession(id);
    assert.equal((await getSessionUser(session))?.emailRequired, true);
    assert.throws(() => assertAccountEmailComplete(legacy), { code: "email_required" });
    await completeAccountEmail(id, email.toUpperCase());
    assert.equal((await getSessionUser(session))?.emailRequired, undefined);
    assert.equal((await authenticateAccount(email.toUpperCase(), password)).id, id);
    assert.equal(await loginRateLimitSubject(username), await loginRateLimitSubject(email));
    await assert.rejects(completeAccountEmail(id, "other@example.test"), { code: "email_not_required" });

    // An OAuth identity does not need a local email, even when the provider omits it.
    await query("INSERT INTO users (id, username) VALUES ($1, $2)", [socialId, `social_${id.slice(0, 8)}`]);
    await query("INSERT INTO auth_identities (user_id, provider, provider_subject, username_confirmed) VALUES ($1, 'apple', $2, true)", [socialId, randomUUID()]);
    assert.equal((await getSessionUser(await createSession(socialId)))?.emailRequired, undefined);
    await assert.rejects(completeAccountEmail(socialId, email), { code: "email_not_required" });

    let sentCode = "";
    let sent = 0;
    const sender = async (recipient: string, code: string) => {
      assert.equal(recipient, email);
      assert.match(code, /^\d{8}$/);
      sentCode = code;
      sent++;
    };
    await requestPasswordReset("missing@example.test", () => { assert.fail("Unknown address must not receive mail"); });
    await Promise.all([requestPasswordReset(email, sender), requestPasswordReset(email, sender)]);
    assert.equal(sent, 1, "Concurrent resends must honor the cooldown.");
    for (let attempt = 0; attempt < 5; attempt++) {
      const wrong = sentCode === "00000000" ? "99999999" : "00000000";
      await assert.rejects(resetAccountPassword(email, wrong, nextPassword), { code: "invalid_reset_code" });
    }
    const exhausted = await query<{ attempts: number }>("SELECT attempts FROM password_reset_codes WHERE user_id = $1", [id]);
    assert.equal(exhausted.rows[0].attempts, 5, "Failed attempts must survive COMMIT.");
    await assert.rejects(resetAccountPassword(email, sentCode, nextPassword), { code: "invalid_reset_code" });
    await query("DELETE FROM password_reset_codes WHERE user_id = $1", [id]);
    await requestPasswordReset(email, sender);
    const results = await Promise.allSettled([
      resetAccountPassword(email, sentCode, nextPassword), resetAccountPassword(email, sentCode, nextPassword),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, "Only one concurrent redemption may succeed.");
    assert.equal(await getSessionUser(session), null, "Old sessions must be revoked.");
    await assert.rejects(authenticateAccount(username, password), { code: "invalid_credentials" });
    assert.equal((await authenticateAccount(email, nextPassword)).id, id);

    await requestPasswordReset(email, sender);
    await query("UPDATE password_reset_codes SET created_at = now() - INTERVAL '11 minutes', expires_at = now() - INTERVAL '1 minute' WHERE user_id = $1", [id]);
    await assert.rejects(resetAccountPassword(email, sentCode, password), { code: "invalid_reset_code" });
    console.log("Account email, provider exemption, reset expiry, attempts, concurrency, and session revocation passed.");
  } finally {
    await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[id, socialId]]);
  }
}

run().catch(() => { console.error("Account security smoke failed."); process.exitCode = 1; }).finally(closePool);
