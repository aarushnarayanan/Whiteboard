import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import LoginForm from "./auth/LoginForm";
import Dashboard from "./dashboard/Dashboard";
import BoardRoute from "./board/BoardRoute";
import { logout, me as fetchMe, type Me } from "./api/auth";
import "./App.css";

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    // A page restored from the browser's back-forward cache (e.g. hitting
    // "back" after navigating away, like the Google OAuth redirect) skips
    // this component's mount logic entirely — it's a snapshot of whatever
    // React state existed at the moment of navigating away, not a fresh
    // load. That snapshot can be stale (e.g. from before a logout in the
    // same tab), so re-check the real session with the server whenever one
    // is restored, instead of trusting the cached UI.
    function handlePageShow(e: PageTransitionEvent) {
      if (!e.persisted) return;
      fetchMe().then(setMe);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  async function handleLogout() {
    await logout();
    setMe(null);
  }

  if (checkingSession) return null;

  if (!me) {
    return <LoginForm onAuthed={setMe} />;
  }

  const dashboard = (
    <Dashboard me={me} onLogout={handleLogout} onMeUpdated={setMe} onAccountDeleted={() => setMe(null)} />
  );

  return (
    <Routes>
      <Route path="/" element={dashboard} />
      <Route path="/recent" element={dashboard} />
      <Route path="/starred" element={dashboard} />
      <Route path="/shared" element={dashboard} />
      <Route path="/trash" element={dashboard} />
      <Route path="/settings" element={dashboard} />
      <Route path="/b/:boardId" element={<BoardRoute me={me} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
