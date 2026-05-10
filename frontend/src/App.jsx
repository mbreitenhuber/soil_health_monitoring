import { useEffect, useState } from "react";
import "./App.css";

const API_URL = `http://localhost:8000`;

function DragonIcon({ delay }) {
  return (
    <span className="dragon-icon" style={{ animationDelay: `${delay}s` }}>
      🐉
    </span>
  );
}

export default function App() {
  const [n, setN] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDragons = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/dragons`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setN(data.n);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDragons();
  }, []);

  return (
    <div className="page">
      <div className="vignette" />
      <div className="content">
        <h1 className="title">
          <span className="title-here">Here Be</span>
          <br />
          <span className="title-n">
            {loading ? "..." : error ? "?" : n}
          </span>
          <br />
          <span className="title-dragons">Dragons</span>
        </h1>

        {error && <p className="error">Could not summon dragons: {error}</p>}

        {!loading && !error && n && (
          <div className="dragon-parade">
            {Array.from({ length: n }, (_, i) => (
              <DragonIcon key={i} delay={i * 0.12} />
            ))}
          </div>
        )}

        <button className="summon-btn" onClick={fetchDragons} disabled={loading}>
          {loading ? "Summoning..." : "Summon Again"}
        </button>

        <p className="subtitle">
          Each click consults the ancient backend oracle for a new count.
        </p>
      </div>
    </div>
  );
}
