import { Navigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';

export default function ShopPage() {
  return <Navigate to={ROUTES.mainMenu} replace />;
}
