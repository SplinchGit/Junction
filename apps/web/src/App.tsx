import { useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";
import { config } from "./config";

declare module "firebase/auth";
declare module "firebase/firestore";

const categoryLabels: Record<string, string> = {
  FRIENDS_FAMILY: "Friends & Family",
  WORK: "Work",
  PROJECTS: "Projects",
  COMMUNITIES: "Communities",
  NEWS: "News",
  SYSTEM: "System",
  OTHER: "Other",
};

type FeedItem = {
  id: string;
  source: string;
  category: string;
  title: string;
  body?: string;
  timestamp: number;
  status: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
};

type Conversation = {
  id: string;
  updatedAt: number;
};

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

type PendingToolCall = {
  id: string;
  name: string;
  args: any;
  summary: string;
};

// §4.3 read-only audit mirror. Deliberately excludes argumentsJson/planText —
// the companion mirrors outcomes for visibility, not the sensitive payloads
// of what ran. There is no write path for this collection from the web
// client; it is populated only by the Android app's AuditSyncManager.
type AuditLogEntry = {
  id: string;
  timestamp: number;
  toolName: string;
  decision: string;
  outcome?: string;
  riskTier: string;
  blockReason?: string;
};

type RealtimeSession = {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  keepAlive: boolean;
};

type RealtimeError = {
  message: string;
  status?: number;
  detail?: string;
  canRetry?: boolean;
};

const { realtimeEndpoint, isDev, hasFirebaseConfig, firebaseMissing } = config;
const maxMessageLength = 4000;
const warnAtLength = 3500;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"feed" | "chat">("feed");
  const [speechModes, setSpeechModes] = useState<Record<string, boolean>>({});
  const [micMuted, setMicMuted] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [streamingText, setStreamingText] = useState("");
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([]);
  const [realtimeError, setRealtimeError] = useState<RealtimeError | null>(null);

  const rtcRef = useRef<RealtimeSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamingRef = useRef("");
  const disconnectAfterResponse = useRef(false);
  const speechMode = activeConversation ? !!speechModes[activeConversation] : false;
  const inputLength = input.length;
  const overLimit = inputLength > maxMessageLength;
  const showCounter = inputLength >= warnAtLength;
  const canSend =
    !!user && !!realtimeEndpoint && !overLimit && input.trim().length > 0;
  const showRealtimeMissing = tab === "chat" && !realtimeEndpoint;

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setMessages([]);
      setFeedItems([]);
      setActiveConversation(null);
      setSpeechModes({});
      setMicMuted(true);
      setPendingToolCalls([]);
      setRealtimeError(null);
      disconnectRealtime();
      return;
    }

    const convRef = collection(db, "users", user.uid, "conversations");
    const convQuery = query(convRef, orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(convQuery, (snap: { docs: any[] }) => {
      const data = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        updatedAt: docSnap.data().updatedAt?.toMillis?.() ?? Date.now(),
      }));
      const modes: Record<string, boolean> = {};
      snap.docs.forEach((docSnap) => {
        const enabled = docSnap.data().speechModeEnabled;
        if (typeof enabled === "boolean") {
          modes[docSnap.id] = enabled;
        }
      });
      setConversations(data);
      if (Object.keys(modes).length) {
        setSpeechModes((prev) => ({ ...prev, ...modes }));
      }
      if (!activeConversation && data.length > 0) {
        setActiveConversation(data[0].id);
      }
    });
    return () => unsub();
  }, [user, activeConversation]);

  useEffect(() => {
    if (!user || !activeConversation) {
      setMessages([]);
      setStreamingText("");
      streamingRef.current = "";
      return;
    }
    setPendingToolCalls([]);
    const msgRef = collection(
      db,
      "users",
      user.uid,
      "conversations",
      activeConversation,
      "messages"
    );
    const msgQuery = query(msgRef, orderBy("createdAt", "asc"));
    const unsub = onSnapshot(msgQuery, (snap: { docs: any[] }) => {
      const data = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        role: docSnap.data().role,
        content: docSnap.data().content,
        createdAt: docSnap.data().createdAt?.toMillis?.() ?? Date.now(),
      }));
      setMessages(data);
    });
    return () => unsub();
  }, [user, activeConversation]);

  useEffect(() => {
    if (!user || !activeConversation) return;
    setDoc(
      doc(db, "users", user.uid, "conversations", activeConversation),
      { speechModeEnabled: speechMode },
      { merge: true }
    );
  }, [speechMode, user, activeConversation]);

  useEffect(() => {
    if (!user) return;
    const feedRef = collection(db, "users", user.uid, "feed_items");
    const feedQuery = query(feedRef, orderBy("timestamp", "desc"));
    const unsub = onSnapshot(feedQuery, (snap: { docs: any[] }) => {
      const data = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        source: docSnap.data().source,
        category: docSnap.data().category,
        title: docSnap.data().title,
        body: docSnap.data().body ?? "",
        timestamp: docSnap.data().timestamp ?? Date.now(),
        status: docSnap.data().status ?? "NEW",
      }));
      setFeedItems(data);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const auditRef = collection(db, "users", user.uid, "audit_log");
    const auditQuery = query(auditRef, orderBy("timestamp", "desc"), limit(50));
    const unsub = onSnapshot(auditQuery, (snap: { docs: any[] }) => {
      const data = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        timestamp: docSnap.data().timestamp ?? Date.now(),
        toolName: docSnap.data().toolName ?? "unknown",
        decision: docSnap.data().decision ?? "",
        outcome: docSnap.data().outcome,
        riskTier: docSnap.data().riskTier ?? "",
        blockReason: docSnap.data().blockReason,
      }));
      setAuditLog(data);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (tab !== "chat") {
      disconnectRealtime();
      return;
    }
    if (speechMode && user) {
      ensureRealtime(true).catch(() => null);
    }
  }, [speechMode, tab, user, activeConversation]);

  useEffect(() => {
    if (rtcRef.current?.pc) {
      disconnectRealtime();
      if (speechMode && user && tab === "chat") {
        ensureRealtime(true).catch(() => null);
      }
    }
  }, [activeConversation]);

  useEffect(() => {
    if (!speechMode) {
      setMicMuted(true);
      if (audioRef.current) audioRef.current.muted = true;
      if (rtcRef.current?.keepAlive) {
        disconnectRealtime();
      }
    } else if (audioRef.current) {
      audioRef.current.muted = false;
      if (rtcRef.current && !rtcRef.current.localStream) {
        disconnectRealtime();
      }
    }
  }, [speechMode]);

  useEffect(() => {
    const stream = rtcRef.current?.localStream;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !micMuted;
      });
    }
  }, [micMuted]);

  const groupedFeed = useMemo(() => {
    const active = feedItems.filter((item) => item.status !== "ARCHIVED");
    return active.reduce<Record<string, FeedItem[]>>((acc, item) => {
      acc[item.category] = acc[item.category] || [];
      acc[item.category].push(item);
      return acc;
    }, {});
  }, [feedItems]);

  async function handleSignIn() {
    await signInWithPopup(auth, googleProvider);
  }

  async function handleSignOut() {
    await signOut(auth);
  }

  function setSpeechModeForConversation(enabled: boolean) {
    if (!activeConversation) return;
    setSpeechModes((prev) => ({ ...prev, [activeConversation]: enabled }));
  }

  async function ensureConversation(): Promise<string> {
    if (!user) throw new Error("Sign in required");
    let conversationId = activeConversation;
    if (!conversationId) {
      const convRef = collection(db, "users", user.uid, "conversations");
      const docRef = await addDoc(convRef, { updatedAt: serverTimestamp() });
      conversationId = docRef.id;
      setActiveConversation(conversationId);
    }
    return conversationId;
  }

  async function appendMessage(role: Message["role"], content: string) {
    if (!user) return;
    const conversationId = await ensureConversation();
    const msgRef = collection(
      db,
      "users",
      user.uid,
      "conversations",
      conversationId,
      "messages"
    );
    await addDoc(msgRef, {
      role,
      content,
      createdAt: serverTimestamp(),
      provenance: "UNTRUSTED",
      sourceRef: "companion:web",
    });
    await setDoc(
      doc(db, "users", user.uid, "conversations", conversationId),
      { updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  async function sendMessage() {
    if (!user || !input.trim()) return;
    if (!realtimeEndpoint) {
      setRealtimeError({
        message: "Realtime not configured. Set VITE_REALTIME_ENDPOINT to continue.",
        canRetry: false,
      });
      return;
    }
    if (overLimit) {
      setRealtimeError({
        message: `Message too long (max ${maxMessageLength} characters).`,
        canRetry: false,
      });
      return;
    }
    const text = input.trim();
    setRealtimeError(null);
    const keepAlive = speechMode;
    disconnectAfterResponse.current = !keepAlive;
    const ready = await ensureRealtime(keepAlive, true);
    if (!ready) return;
    await appendMessage("user", text);
    setInput("");
    const sent = sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    if (!sent) {
      setRealtimeError({
        message: "Realtime connection not ready. Please retry.",
        canRetry: true,
      });
      return;
    }
    sendEvent({ type: "response.create" });
    setTab("chat");
  }

  async function markSeen(item: FeedItem) {
    if (!user) return;
    await setDoc(
      doc(db, "users", user.uid, "feed_items", item.id),
      { status: "SEEN" },
      { merge: true }
    );
  }

  async function archive(item: FeedItem) {
    if (!user) return;
    await setDoc(
      doc(db, "users", user.uid, "feed_items", item.id),
      { status: "ARCHIVED" },
      { merge: true }
    );
  }

  function mapRealtimeError(status?: number) {
    if (status === 401 || status === 403) {
      return "Signed in, but Realtime rejected the token. Check Firebase project or endpoint config.";
    }
    if (status === 404) {
      return "Realtime endpoint not found. Check the endpoint URL.";
    }
    if (status && status >= 500) {
      return "Realtime server error. Try again shortly.";
    }
    return "Realtime connection failed.";
  }

  function waitForChannelOpen(channel: RTCDataChannel, timeoutMs = 6000) {
    return new Promise<boolean>((resolve) => {
      if (channel.readyState === "open") {
        resolve(true);
        return;
      }
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      const handleOpen = () => {
        window.clearTimeout(timer);
        finish(true);
      };
      const handleClose = () => {
        window.clearTimeout(timer);
        finish(false);
      };
      channel.addEventListener("open", handleOpen, { once: true });
      channel.addEventListener("close", handleClose, { once: true });
      channel.addEventListener("error", handleClose, { once: true });
    });
  }

  async function ensureRealtime(keepAlive: boolean, waitForOpen = false) {
    if (!user) return false;
    if (!realtimeEndpoint) {
      setConnectionState("error");
      return false;
    }
    if (rtcRef.current?.pc) {
      if (!waitForOpen) return true;
      const channel = rtcRef.current.dataChannel;
      if (!channel) return false;
      return waitForChannelOpen(channel);
    }

    try {
      setConnectionState("connecting");
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      let localStream: MediaStream | undefined;
      if (speechMode) {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.getAudioTracks().forEach((track) => {
          track.enabled = !micMuted;
          pc.addTrack(track, localStream as MediaStream);
        });
      }

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (audioRef.current && stream) {
          audioRef.current.srcObject = stream;
          audioRef.current.play().catch(() => null);
        }
      };

      const dataChannel = pc.createDataChannel("oai-events");
      dataChannel.onopen = async () => {
        setConnectionState("connected");
        setRealtimeError(null);
        await seedConversation();
      };
      dataChannel.onmessage = (event) => {
        handleEvent(event.data);
      };
      dataChannel.onclose = () => {
        setConnectionState("disconnected");
        if (speechMode) {
          disconnectRealtime();
          ensureRealtime(true).catch(() => null);
        }
      };

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);
      await waitForIce(pc);

      const token = await user.getIdToken();
      const response = await fetch(realtimeEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp",
        },
        body: pc.localDescription?.sdp || "",
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        setConnectionState("error");
        setRealtimeError({
          message: mapRealtimeError(response.status),
          status: response.status,
          detail,
          canRetry: true,
        });
        return false;
      }
      const answer = await response.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      rtcRef.current = { pc, dataChannel, localStream, keepAlive };
      if (waitForOpen) {
        return waitForChannelOpen(dataChannel);
      }
      return true;
    } catch (err: any) {
      setConnectionState("error");
      setRealtimeError({
        message: "Realtime connection failed.",
        detail: err?.message || String(err),
        canRetry: true,
      });
      return false;
    }
  }

  function disconnectRealtime() {
    rtcRef.current?.dataChannel?.close();
    rtcRef.current?.pc?.close();
    rtcRef.current?.localStream?.getTracks().forEach((track) => track.stop());
    rtcRef.current = null;
    setConnectionState("disconnected");
  }

  function sendEvent(event: any) {
    const channel = rtcRef.current?.dataChannel;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }

  async function seedConversation() {
    if (!messages.length) return;
    messages.slice(-20).forEach((msg) => {
      const contentType = msg.role === "user" ? "input_text" : "output_text";
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: msg.role === "user" ? "user" : "assistant",
          content: [{ type: contentType, text: msg.content }],
        },
      });
    });
  }

  function handleEvent(raw: string) {
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const type = json.type;
    if (type === "response.output_text.delta") {
      const delta = json.delta || json.text || "";
      if (delta) {
        streamingRef.current += delta;
        setStreamingText(streamingRef.current);
      }
      return;
    }
    if (type === "response.output_text.done") {
      const text = json.text || json.final || streamingRef.current;
      if (text) {
        appendMessage("assistant", text);
        streamingRef.current = "";
        setStreamingText("");
      }
      return;
    }
    if (type === "response.done") {
      const output = json.response?.output || json.response?.output_items || [];
      const calls: PendingToolCall[] = [];
      output.forEach((item: any) => {
        if (item.type === "function_call") {
          const args = safeJson(item.arguments);
          calls.push({
            id: item.call_id || item.id,
            name: item.name,
            args,
            summary: summarizeTool(item.name, args),
          });
        }
      });
      if (calls.length) {
        setPendingToolCalls((prev) => {
          const existing = new Set(prev.map((c) => c.id));
          const fresh = calls.filter((c) => !existing.has(c.id));
          return [...prev, ...fresh];
        });
      }
      if (disconnectAfterResponse.current && !speechMode) {
        disconnectAfterResponse.current = false;
        disconnectRealtime();
      }
      return;
    }
    if (type === "error") {
      setConnectionState("error");
      setRealtimeError({
        message: "Realtime returned an error.",
        detail: JSON.stringify(json),
        canRetry: true,
      });
    }
  }

  async function stopResponse() {
    setStreamingText("");
    streamingRef.current = "";
    sendEvent({ type: "response.cancel" });
  }

  async function regenerateResponse() {
    const keepAlive = speechMode;
    disconnectAfterResponse.current = !keepAlive;
    await ensureRealtime(keepAlive);
    sendEvent({ type: "response.create" });
  }

  async function applyTool(call: PendingToolCall) {
    setPendingToolCalls((prev) => prev.filter((c) => c.id !== call.id));
    await appendMessage("system", `Blocked on PC companion: ${call.summary}. Actions must be approved and executed in the Android app.`);
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: call.id,
        output: JSON.stringify({
          status: "blocked",
          message: "The PC companion cannot execute actions. Use the Android app for approved actions."
        }),
      },
    });
    sendEvent({ type: "response.create" });
  }

  function safeJson(raw: any) {
    if (!raw) return {};
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return {};
    }
  }

  function summarizeTool(name: string, args: any) {
    switch (name) {
      case "set_speech_mode":
        return `Set speech mode to ${!!args.enabled}`;
      case "set_feed_filter":
        return `Set feed filter ${args.packageName} = ${!!args.enabled}`;
      case "archive_feed_item":
        return `Archive feed item ${args.id}`;
      case "check_for_updates":
        return "Check for updates";
      case "set_setting":
        return `Set ${args.key}`;
      default:
        return name;
    }
  }

  function waitForIce(pc: RTCPeerConnection) {
    return new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }
      const handler = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", handler);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", handler);
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Junction</div>
        <nav>
          <button
            className={tab === "feed" ? "active" : ""}
            onClick={() => setTab("feed")}
          >
            Feed
          </button>
          <button
            className={tab === "chat" ? "active" : ""}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
        </nav>
        <div className="account">
          {user ? (
            <>
              <div className="account-email">{user.email}</div>
              <button onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <button onClick={handleSignIn}>Sign in with Google</button>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-row">
            <h1>{tab === "feed" ? "Calm Feed" : "JunctionGPT"}</h1>
            <span className={`status-pill ${connectionState}`}>{connectionState}</span>
          </div>
          <p>{tab === "feed" ? "Local-first overview" : "Shared conversation"}</p>
        </header>

        {!hasFirebaseConfig && (
          <div className="banner error">
            <div className="banner-title">Firebase config missing</div>
            <div className="banner-message">
              Set the required VITE_FIREBASE_* values in apps/web/.env to enable sign-in
              and data sync.
            </div>
            {isDev && firebaseMissing.length > 0 && (
              <details>
                <summary>Details</summary>
                <pre>{firebaseMissing.join(", ")}</pre>
              </details>
            )}
          </div>
        )}

        {tab === "feed" && (
          <section className="feed">
            {!user && <div className="empty">Sign in to see your feed.</div>}
            {user && Object.keys(groupedFeed).length === 0 && (
              <div className="empty">No active feed items yet.</div>
            )}
            {Object.entries(groupedFeed).map(([category, items]) => (
              <div key={category} className="feed-group">
                <div className="feed-header">
                  <h2>{categoryLabels[category] ?? category}</h2>
                  <span>{items.length} items</span>
                </div>
                <div className="feed-list">
                  {items.map((item) => (
                    <article key={item.id} className="feed-card">
                      <div className="feed-meta">
                        <span>{item.source}</span>
                        <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <h3>{item.title}</h3>
                      {item.body && <p>{item.body}</p>}
                      <div className="feed-actions">
                        <button onClick={() => markSeen(item)}>Mark seen</button>
                        <button onClick={() => archive(item)}>Archive</button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
            {user && auditLog.length > 0 && (
              <div className="feed-group">
                <div className="feed-header">
                  <h2>Audit log (read-only)</h2>
                  <span>{auditLog.length} recent</span>
                </div>
                <div className="feed-list">
                  {auditLog.map((entry) => (
                    <article key={entry.id} className="feed-card">
                      <div className="feed-meta">
                        <span>{entry.toolName}</span>
                        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p>
                        {entry.decision}
                        {entry.outcome ? ` · ${entry.outcome}` : ""}
                        {entry.blockReason ? ` · blocked: ${entry.blockReason}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "chat" && (
          <section className="chat">
            {!user && <div className="empty">Sign in to chat.</div>}
            {user && (
              <div className="chat-layout">
                <div className="conversation-list">
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      className={conv.id === activeConversation ? "active" : ""}
                      onClick={() => setActiveConversation(conv.id)}
                    >
                      {conv.id.slice(0, 8)}
                    </button>
                  ))}
                </div>
                <div className="conversation">
                  <div className="conversation-controls">
                    <label>
                        <input
                          type="checkbox"
                          checked={speechMode}
                          onChange={(e) => setSpeechModeForConversation(e.target.checked)}
                        />
                      Speech mode
                    </label>
                    {speechMode && (
                      <label>
                        <input
                          type="checkbox"
                          checked={!micMuted}
                          onChange={(e) => setMicMuted(!e.target.checked)}
                        />
                        Mic
                      </label>
                    )}
                    <button className="ghost" onClick={stopResponse}>
                      Stop
                    </button>
                    <button className="ghost" onClick={regenerateResponse}>
                      Regenerate
                    </button>
                  </div>
                  <div className="messages">
                    {messages.map((message) => (
                      <div key={message.id} className={`bubble ${message.role}`}>
                        <p>{message.content}</p>
                      </div>
                    ))}
                    {streamingText && (
                      <div className="bubble assistant streaming">
                        <p>{streamingText}</p>
                      </div>
                    )}
                  </div>
                  {pendingToolCalls.length > 0 && (
                    <div className="tool-calls">
                      {pendingToolCalls.map((call) => (
                        <div key={call.id} className="tool-card">
                          <div className="tool-title">Proposed change</div>
                          <div className="tool-summary">{call.summary}</div>
                          <div className="tool-actions">
                            <button onClick={() => applyTool(call)}>
                              Decline on PC
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {showRealtimeMissing && (
                    <div className="banner warn">
                      Realtime not configured. Set VITE_REALTIME_ENDPOINT to enable chat.
                    </div>
                  )}
                  {realtimeError && (
                    <div className="banner error">
                      <div className="banner-title">Realtime error</div>
                      <div className="banner-message">{realtimeError.message}</div>
                      {realtimeError.status && (
                        <div className="banner-meta">Status {realtimeError.status}</div>
                      )}
                      {isDev && realtimeError.detail && (
                        <details>
                          <summary>Details</summary>
                          <pre>{realtimeError.detail}</pre>
                        </details>
                      )}
                      {realtimeError.canRetry && (
                        <div className="banner-actions">
                          <button
                            className="ghost"
                            onClick={sendMessage}
                            disabled={!input.trim() || overLimit}
                          >
                            Retry
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="composer">
                    <div className="composer-row">
                      <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type a message"
                        disabled={!user}
                        className={overLimit ? "over-limit" : ""}
                      />
                      <button onClick={sendMessage} disabled={!canSend}>
                        Send
                      </button>
                    </div>
                    <div className="composer-meta">
                      {showCounter && (
                        <span className={`composer-counter ${overLimit ? "over" : ""}`}>
                          {inputLength}/{maxMessageLength}
                        </span>
                      )}
                      {overLimit && (
                        <span className="composer-hint">
                          Message too long. Trim to {maxMessageLength} characters.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
      <audio ref={audioRef} autoPlay />
    </div>
  );
}
