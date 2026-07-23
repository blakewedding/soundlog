import { Routes, Route, useLocation } from "react-router-dom";
import { Nav } from "./components/ui/Nav";
import { BuildStamp } from "./components/ui/BuildStamp";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Explore from "./pages/Explore";
import Release from "./pages/Release";
import Artist from "./pages/Artist";
import Label from "./pages/Label";
import Genre from "./pages/Genre";
import Year from "./pages/Year";
import Login from "./pages/Login";
import Lists from "./pages/Lists";
import ListDetail from "./pages/ListDetail";
import Diary from "./pages/Diary";
import Profile from "./pages/Profile";

export default function App() {
  const location = useLocation();

  return (
    <>
      <Nav />
      {/* Keying <main> on the path restarts the fade on every route change.
          Without the key React reuses the element and the animation, having
          already run once, never plays again. */}
      <main
        key={location.pathname}
        className="container page-enter"
        style={{ paddingTop: 40, paddingBottom: 64 }}
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/release/:id" element={<Release />} />
          <Route path="/artist/:id" element={<Artist />} />
          <Route path="/label/:id" element={<Label />} />
          <Route path="/genre/:tag" element={<Genre />} />
          <Route path="/year/:year" element={<Year />} />
          <Route path="/login" element={<Login />} />
          <Route path="/lists" element={<Lists />} />
          <Route path="/list/:id" element={<ListDetail />} />
          <Route path="/diary" element={<Diary />} />
          {/* Public member profile — kept last so static routes win the match. */}
          <Route path="/:username" element={<Profile />} />
        </Routes>
      </main>
      <BuildStamp />
    </>
  );
}
