import { useEffect, useMemo, useState } from "react";
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
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"feed" | "chat">("feed");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setMessages([]);
      setFeedItems([]);
      setActiveConversation(null);
      return;
    }

    const convRef = collection(db, "users", user.uid, "conversations");
    const convQuery = query(convRef, orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(convQuery, (snap) => {
      const data = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        updatedAt: docSnap.data().updatedAt?.toMillis?.() ?? Date.now(),
      }));
      setConversations(data);
      if (!activeConversation && data.length > 0) {
        setActiveConversation(data[0].id);
      }
    });
    return () => unsub();
  }, [user, activeConversation]);

  useEffect(() => {
    if (!user || !activeConversation) {
      setMessages([]);
      return;
    }
    const msgRef = collection(
      db,
      "users",
      user.uid,
      "conversations",
      activeConversation,
      "messages"
    );
    const msgQuery = query(msgRef, orderBy("createdAt", "asc"));
    const unsub = onSnapshot(msgQuery, (snap) => {
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
    if (!user) return;
    const feedRef = collection(db, "users", user.uid, "feed_items");
    const feedQuery = query(feedRef, orderBy("timestamp", "desc"));
    const unsub = onSnapshot(feedQuery, (snap) => {
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

  async function sendMessage() {
    if (!user || !input.trim()) return;
    let conversationId = activeConversation;

    if (!conversationId) {
      const convRef = collection(db, "users", user.uid, "conversations");
      const docRef = await addDoc(convRef, { updatedAt: serverTimestamp() });
      conversationId = docRef.id;
      setActiveConversation(conversationId);
    }

    const msgRef = collection(
      db,
      "users",
      user.uid,
      "conversations",
      conversationId,
      "messages"
    );

    await addDoc(msgRef, {
      role: "user",
      content: input.trim(),
      createdAt: serverTimestamp(),
    });

    await setDoc(
      doc(db, "users", user.uid, "conversations", conversationId),
      { updatedAt: serverTimestamp() },
      { merge: true }
    );

    setInput("");
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
          <h1>{tab === "feed" ? "Calm Feed" : "JunctionGPT"}</h1>
          <p>{tab === "feed" ? "Local-first overview" : "Shared conversation"}</p>
        </header>

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
                  <div className="messages">
                    {messages.map((message) => (
                      <div key={message.id} className={`bubble ${message.role}`}>
                        <p>{message.content}</p>
                      </div>
                    ))}
                  </div>
                  <div className="composer">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Type a message"
                    />
                    <button onClick={sendMessage}>Send</button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
