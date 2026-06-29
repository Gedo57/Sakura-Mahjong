import { Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from './routes.js';
import AppLayout from '../layouts/AppLayout.jsx';
import StartScreenPage from '../pages/StartScreenPage.jsx';
import MockLoginPage from '../pages/MockLoginPage.jsx';
import LoadingPage from '../pages/LoadingPage.jsx';
import MainMenuPage from '../pages/MainMenuPage.jsx';
import ProfilePage from '../pages/ProfilePage.jsx';
import RoomSelectPage from '../pages/RoomSelectPage.jsx';
import CreateRoomPage from '../pages/CreateRoomPage.jsx';
import JoinRoomPage from '../pages/JoinRoomPage.jsx';
import PrivateLobbyPage from '../pages/PrivateLobbyPage.jsx';
import MatchmakingPage from '../pages/MatchmakingPage.jsx';
import MahjongGamePage from '../pages/MahjongGamePage.jsx';
import ResultPage from '../pages/ResultPage.jsx';
import ShopPage from '../pages/ShopPage.jsx';
import LeaderboardPage from '../pages/LeaderboardPage.jsx';
import MissionsPage from '../pages/MissionsPage.jsx';
import MatchHistoryPage from '../pages/MatchHistoryPage.jsx';
import AchievementsPage from '../pages/AchievementsPage.jsx';
import ProtectedRoute from './ProtectedRoute.jsx';

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* Public Routes */}
        <Route path={ROUTES.start} element={<StartScreenPage />} />
        <Route path={ROUTES.login} element={<MockLoginPage />} />
        <Route path={ROUTES.loading} element={<LoadingPage />} />
        <Route path={ROUTES.mockGame} element={<MahjongGamePage mockMode />} />
        <Route path={ROUTES.gameplayMock} element={<MahjongGamePage mockMode />} />
        <Route path={ROUTES.mockGameCompact} element={<MahjongGamePage mockMode />} />

        {/* Protected Routes */}
        <Route path={ROUTES.mainMenu} element={<ProtectedRoute><MainMenuPage /></ProtectedRoute>} />
        <Route path={ROUTES.profile} element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path={ROUTES.shop} element={<ProtectedRoute><ShopPage /></ProtectedRoute>} />
        <Route path={ROUTES.leaderboard} element={<ProtectedRoute><LeaderboardPage /></ProtectedRoute>} />
        <Route path={ROUTES.missions} element={<ProtectedRoute><MissionsPage /></ProtectedRoute>} />
        <Route path={ROUTES.matchHistory} element={<ProtectedRoute><MatchHistoryPage /></ProtectedRoute>} />
        <Route path={ROUTES.achievements} element={<ProtectedRoute><AchievementsPage /></ProtectedRoute>} />
        <Route path={ROUTES.rooms} element={<ProtectedRoute><RoomSelectPage /></ProtectedRoute>} />
        <Route path={ROUTES.createRoom} element={<ProtectedRoute><CreateRoomPage /></ProtectedRoute>} />
        <Route path={ROUTES.joinRoom} element={<ProtectedRoute><JoinRoomPage /></ProtectedRoute>} />
        <Route path={ROUTES.privateLobby} element={<ProtectedRoute><PrivateLobbyPage /></ProtectedRoute>} />
        <Route path={ROUTES.matchmaking} element={<ProtectedRoute><MatchmakingPage /></ProtectedRoute>} />
        <Route path={ROUTES.game} element={<ProtectedRoute><MahjongGamePage /></ProtectedRoute>} />
        <Route path={ROUTES.result} element={<ProtectedRoute><ResultPage /></ProtectedRoute>} />
        
        <Route path={ROUTES.gameFallback} element={<Navigate to={ROUTES.matchmaking} replace />} />
      </Route>
      <Route path="*" element={<Navigate to={ROUTES.start} replace />} />
    </Routes>
  );
}
