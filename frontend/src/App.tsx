import { BrowserRouter } from 'react-router';

import { AuthProvider } from './hooks/AuthContext';
import { AppRoutes } from './routes/AppRouter';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
