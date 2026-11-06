import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Route, Routes, useLocation } from "react-router-dom";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { LandingPage } from "./pages/LandingPage";
import { BuildingPage } from "./pages/BuildingPage";
import { RoomPage } from "./pages/RoomPage";
import { TablePage } from "./pages/TablePage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AccountPage } from "./pages/AccountPage";

// Lobby -> Table "expand from center": a route change is a state transition,
// not a page load, so it gets a brief scale+fade instead of a hard cut.
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <Routes location={location}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/building/:buildingSlug" element={<BuildingPage />} />
          <Route path="/room/:slug" element={<RoomPage />} />
          <Route path="/room/:slug/:mode" element={<TablePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  // Single switch for every motion.* animation in the app (this route
  // transition, PhaseBanner's phase cross-fade, BreakModal's card sequence,
  // TableDashboard's ticket cards) — CLAUDE.md's reduced-motion stance
  // applies globally, not per-component. "user" reads the OS-level
  // prefers-reduced-motion media query itself, live.
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen bg-canvas">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <AnimatedRoutes />
        </div>
      </div>
    </MotionConfig>
  );
}
