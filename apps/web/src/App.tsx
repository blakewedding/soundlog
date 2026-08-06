import { Routes, Route, useLocation } from "react-router-dom";
import { Nav } from "./components/ui/Nav";
import { CampaignBanner } from "./components/ui/CampaignBanner";
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
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Settings from "./pages/Settings";
import ConfirmEmail from "./pages/ConfirmEmail";
import Privacy from "./pages/Privacy";
import VerifyReminder from "./components/ui/VerifyReminder";
import { Footer } from "./components/ui/Footer";

export default function App() {
  const location = useLocation();

  return (
    <>
      {/* Campaign-duration only. Removing it is deleting this line and
          CampaignBanner.tsx — nothing else references it. Above <Nav> in normal
          flow so the nav keeps pinning to top: 0 once the strip scrolls away. */}
      <CampaignBanner />
      <Nav />
      {/* Keying <main> on the path restarts the fade on every route change.
          Without the key React reuses the element and the animation, having
          already run once, never plays again. */}
      <main
        key={location.pathname}
        className="container page-enter"
        style={{ paddingTop: 40, paddingBottom: 64 }}
      >
        <VerifyReminder />
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
          {/* Email flows. These MUST sit above /:username — that route matches
              any single segment, so a verify link would otherwise render a
              profile page for a member called "verify-email". */}
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* Same rule as the email flows above: this MUST sit above /:username,
              and "settings" is now a name nobody may register — otherwise the
              account that took it would have a permanently unreachable profile.
              See backend/src/config/reservedUsernames.ts; the pairing is
              enforced by App.reservedRoutes.test.ts. */}
          <Route path="/settings" element={<Settings />} />
          {/* Landing page for the link sent to a NEW address. Above
              /:username for the same reason as the rest. */}
          <Route path="/confirm-email" element={<ConfirmEmail />} />
          {/* Static prose, no data dependency. Above /:username by the same
              rule as everything else here, and "privacy" is reserved. */}
          <Route path="/privacy" element={<Privacy />} />
          {/* Public member profile — kept last so static routes win the match. */}
          <Route path="/:username" element={<Profile />} />
        </Routes>
      </main>
      {/* Outside <main> and outside its pathname key: the footer is chrome, and
          re-keying it on every route change would restart its render for no
          reason. */}
      <Footer />
      <BuildStamp />
    </>
  );
}
