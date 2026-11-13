/**
 * @param {{ DB: import("./lib/db.js").Database }} env
 * @param {{ actor: string, action: string, targetType: string, targetId: string, detail?: object }} event
 * @returns {Promise<void>}
 */
export async function recordAudit(env, { actor, action, targetType, targetId, detail }) {
  await env.DB.prepare(
    "INSERT INTO audit_events (at, actor, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      new Date().toISOString(),
      actor,
      action,
      targetType,
      targetId,
      detail === undefined ? null : JSON.stringify(detail),
    )
    .run();
}
