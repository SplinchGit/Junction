"use strict";

async function registerDevice({ projectId, session, device, syncEnabled = true }) {
  if (!projectId || !session?.idToken) throw new Error("A Firebase project and signed-in owner are required.");
  const document = { fields: {
    deviceId: { stringValue: device.deviceId }, name: { stringValue: device.name }, platform: { stringValue: "windows" },
    appVersion: { stringValue: device.appVersion }, syncEnabled: { booleanValue: Boolean(syncEnabled) },
    createdAt: { timestampValue: device.createdAt }, lastSeenAt: { timestampValue: new Date().toISOString() },
    ...(syncEnabled ? {} : { disabledAt: { timestampValue: new Date().toISOString() } })
  }};
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(session.uid)}/devices/${encodeURIComponent(device.deviceId)}`;
  const response = await fetch(url, { method: "PATCH", headers: { authorization: `Bearer ${session.idToken}`, "content-type": "application/json" }, body: JSON.stringify(document) });
  if (!response.ok) throw new Error(`Device registration failed (${response.status}).`);
  return { registered: true, syncEnabled: Boolean(syncEnabled) };
}

module.exports = { registerDevice };
