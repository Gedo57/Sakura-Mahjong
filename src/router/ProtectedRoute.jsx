import { Navigate, useLocation } from 'react-router-dom';
import { isUserLoggedIn } from '../services/authService.js';
import { ROUTES } from './routes.js';

export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const loggedIn = isUserLoggedIn();

  if (!loggedIn) {
    // Redirect them to the / login/start page, but save the current location they were
    // trying to go to if you want to redirect them back after login later.
    return <Navigate to={ROUTES.start} state={{ from: location }} replace />;
  }

  return children;
}
