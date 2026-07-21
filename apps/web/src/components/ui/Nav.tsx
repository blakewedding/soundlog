import { NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { Wordmark } from "./Wordmark";

export function Nav() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <Link to="/" aria-label="Soundlog — home">
          <Wordmark />
        </Link>
        <div className="nav-links">
          <NavLink to="/">Activity</NavLink>
          <NavLink to="/explore">Explore</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/lists">Lists</NavLink>
          {user && <NavLink to="/diary">Diary</NavLink>}
          {loading ? null : user ? (
            <>
              <NavLink to={`/${user.username}`}>{user.displayName ?? user.username}</NavLink>
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
              >
                Log out
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate("/login")}>
              Log in
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
