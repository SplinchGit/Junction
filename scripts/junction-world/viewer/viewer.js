(() => {
  "use strict";

  const MAX_EVENTS = 200;
  const MAX_TEXT = 2000;
  const POLL_MS = 3000;
  const STALE_MS = 15000;
  const allowedCategories = new Set([
    "WAKE", "SLEEP", "GOAL_CREATED", "GOAL_UPDATED", "GOAL_ABANDONED",
    "GOAL_COMPLETED", "REFLECTION", "INTENTION", "ACTION", "RESULT",
    "RESEARCH", "PROJECT_FILE", "ERROR", "SECURITY_DENIAL", "RESOURCE_WARNING", "SYSTEM",
  ]);
  const communicationDirections = new Set(["OWNER_TO_AGENT", "AGENT_TO_OWNER"]);
  const statusDot = document.querySelector(".status-dot");
  const connectionLabel = document.getElementById("connection-label");
  const worldState = document.getElementById("world-state");
  const worldDescription = document.getElementById("world-description");
  const lastUpdated = document.getElementById("last-updated");
  const conversationList = document.getElementById("conversation-list");
  const activityList = document.getElementById("activity-list");
  const conversationCount = document.getElementById("conversation-count");
  const conversationEmpty = document.getElementById("conversation-empty");
  const activityEmpty = document.getElementById("activity-empty");
  const uptimeLabel = document.getElementById("runtime-uptime");
  const modelLabel = document.getElementById("runtime-model");
  const nextWakeLabel = document.getElementById("runtime-next-wake");
  const activityLabel = document.getElementById("runtime-activity");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatSend = document.getElementById("chat-send");
  const chatFeedback = document.getElementById("chat-feedback");
  let lastSuccessAt = 0;
  let lastConversationKey = "";
  let lastActivityKey = "";

  function setConnection(label, state) {
    connectionLabel.textContent = label;
    statusDot.classList.remove("connected", "stale", "offline");
    if (state) statusDot.classList.add(state);
  }

  function boundedString(value, limit = MAX_TEXT) {
    return typeof value === "string" ? value.slice(0, limit) : "";
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short",
    }).format(date);
  }

  function makeText(tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }

  function validEvent(event) {
    if (!event || typeof event !== "object" || typeof event.id !== "string" || typeof event.occurredAt !== "string") return false;
    if (event.category === "COMMUNICATION") {
      return communicationDirections.has(event.communicationDirection) && typeof event.message === "string";
    }
    return allowedCategories.has(event.category) && typeof event.summary === "string";
  }

  function safeSnapshot(value) {
    if (!value || typeof value !== "object" || typeof value.paused !== "boolean") throw new Error("Invalid status response");
    if (!Number.isInteger(value.heartbeatMinutes) || !Array.isArray(value.events)) throw new Error("Invalid activity response");
    const events = value.events.filter(validEvent).slice(-MAX_EVENTS).map(event => ({
      id: boundedString(event.id, 64),
      occurredAt: boundedString(event.occurredAt, 64),
      category: boundedString(event.category, 32),
      summary: boundedString(event.summary, 280),
      communicationDirection: boundedString(event.communicationDirection, 32),
      source: boundedString(event.source, 16),
      message: boundedString(event.message),
      actionStatus: boundedString(event.actionStatus, 16),
      durationMs: Number.isInteger(event.durationMs) ? event.durationMs : null,
    }));
    return { paused: value.paused, heartbeatMinutes: value.heartbeatMinutes, historyDegraded: value.historyDegraded === true,
      status: boundedString(value.status, 16), activity: boundedString(value.activity, 200), model: boundedString(value.model, 80),
      uptimeSeconds: Number.isInteger(value.uptimeSeconds) ? Math.max(0, value.uptimeSeconds) : 0,
      nextWakeAt: typeof value.nextWakeAt === "number" ? value.nextWakeAt : null,
      updatedAt: boundedString(value.updatedAt, 64), events };
  }

  function renderConversation(events) {
    const messages = events.filter(event => event.category === "COMMUNICATION");
    conversationCount.textContent = `${messages.length} ${messages.length === 1 ? "message" : "messages"}`;
    conversationEmpty.hidden = messages.length > 0;
    const key = messages.map(event => event.id).join("|");
    if (key === lastConversationKey) return;
    lastConversationKey = key;
    for (const old of Array.from(conversationList.querySelectorAll("li.message"))) old.remove();
    for (const event of messages) {
      const isOwner = event.communicationDirection === "OWNER_TO_AGENT";
      const item = document.createElement("li");
      item.className = isOwner ? "message owner" : "message";
      const label = document.createElement("div");
      label.className = "message-label";
      const speaker = isOwner ? (event.source === "debian" ? "James · Debian" : "James · Android") : "Junction";
      label.append(makeText("span", speaker));
      const time = document.createElement("time");
      time.dateTime = event.occurredAt;
      time.textContent = formatTime(event.occurredAt);
      label.append(time);
      item.append(label, makeText("p", event.message));
      conversationList.append(item);
    }
    if (messages.length > 0) conversationList.scrollTop = conversationList.scrollHeight;
  }

  function renderActivity(events) {
    const activity = events.filter(event => event.category !== "COMMUNICATION").slice(-60);
    activityEmpty.hidden = activity.length > 0;
    const key = activity.map(event => event.id).join("|");
    if (key === lastActivityKey) return;
    lastActivityKey = key;
    for (const old of Array.from(activityList.querySelectorAll("li.activity"))) old.remove();
    for (const event of activity.slice().reverse()) {
      const item = document.createElement("li");
      item.className = "activity";
      const meta = document.createElement("div");
      meta.className = "activity-meta";
      meta.append(makeText("span", event.category, "activity-category"));
      const time = document.createElement("time");
      time.dateTime = event.occurredAt;
      time.textContent = formatTime(event.occurredAt);
      meta.append(time);
      item.append(meta, makeText("p", event.summary));
      if (event.actionStatus) item.append(makeText("span", event.actionStatus, "action-status"));
      activityList.append(item);
    }
  }

  function renderStatus(data) {
    const events = data.events;
    const latest = events.length ? events[events.length - 1] : null;
    let lastWakeIndex = -1;
    let lastSleepIndex = -1;
    for (let index = 0; index < events.length; index += 1) {
      if (events[index].category === "WAKE") lastWakeIndex = index;
      if (events[index].category === "SLEEP") lastSleepIndex = index;
    }
    const working = lastWakeIndex > lastSleepIndex;
    const ownerMessageIsNewest = latest?.category === "COMMUNICATION" && latest.communicationDirection === "OWNER_TO_AGENT";
    const statusLabels = { ACTIVE: "Awake", WORKING: "Working", IDLE: "Idle", SLEEPING: "Sleeping", PAUSED: "Paused", ERROR: "Error", STOPPED: "Stopped" };
    const displayStatus = data.paused ? "PAUSED" : (data.status || (working ? "WORKING" : "IDLE"));
    if (data.paused) {
      worldState.textContent = "Paused";
      worldDescription.textContent = "Junction is paused by James.";
    } else {
      worldState.textContent = statusLabels[displayStatus] || "Ready";
      worldDescription.textContent = data.activity || (ownerMessageIsNewest ? "Junction has received your message." : "The runtime is available.");
    }
    uptimeLabel.textContent = data.uptimeSeconds ? `${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor(data.uptimeSeconds % 3600 / 60)}m` : "—";
    modelLabel.textContent = data.model || "—";
    nextWakeLabel.textContent = data.nextWakeAt ? formatTime(new Date(data.nextWakeAt * 1000).toISOString()) : "On event";
    activityLabel.textContent = data.activity || "—";
    chatInput.disabled = data.paused;
    chatSend.disabled = data.paused;
  }

  async function refresh() {
    if (document.hidden) return;
    try {
      const response = await fetch("/v1/ui/snapshot", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Junction service is unavailable");
      const data = safeSnapshot(await response.json());
      lastSuccessAt = Date.now();
      setConnection(data.historyDegraded ? "Connected · history may be incomplete" : "Connected", data.historyDegraded ? "stale" : "connected");
      renderStatus(data);
      renderConversation(data.events);
      renderActivity(data.events);
      const currentTime = data.updatedAt || new Date(lastSuccessAt).toISOString();
      lastUpdated.dateTime = currentTime;
      lastUpdated.textContent = formatTime(currentTime);
    } catch {
      if (!lastSuccessAt || Date.now() - lastSuccessAt > STALE_MS) {
        setConnection("Stale or unavailable", "offline");
        worldDescription.textContent = "The local Junction service has not refreshed. Existing messages remain visible.";
      } else {
        setConnection("Refresh delayed", "stale");
      }
    }
  }

  refresh();
  chatForm.addEventListener("submit", async event => {
    event.preventDefault();
    const content = chatInput.value.trim();
    if (!content) return;
    chatSend.disabled = true;
    chatFeedback.textContent = "Sending to Junction…";
    try {
      const response = await fetch("/v1/ui/messages", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID(), content }), cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(5000),
      });
      const result = await response.json();
      if (!response.ok || !result.accepted) throw new Error(result.error || "Junction did not accept the message");
      chatInput.value = "";
      chatFeedback.textContent = "Sent to the shared Junction conversation.";
      refresh();
    } catch (error) {
      chatFeedback.textContent = error.message || "Message could not be sent.";
    } finally {
      chatSend.disabled = false;
      if (chatInput.disabled) chatSend.disabled = true;
    }
  });
  window.setInterval(refresh, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
})();
