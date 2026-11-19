import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { SetupNeeded, SignIn } from './auth/SignIn';
import { isConfigured } from './lib/env';
import { Shell } from './components/Shell';
import { Today } from './screens/Today';
import { CheckInForm } from './screens/CheckInForm';
import { History } from './screens/History';
import { Patterns } from './screens/Patterns';
import { Periods } from './screens/Periods';
import { PeriodForm } from './screens/PeriodForm';
import { Settings } from './screens/Settings';
import { Calendars } from './screens/Calendars';

function Gate() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <SignIn />;
  return (
    <Routes>
      {/* Full-screen flows without the tab bar */}
      <Route path="check-in" element={<CheckInForm />} />
      <Route path="check-in/:id" element={<CheckInForm />} />
      <Route element={<Shell />}>
        <Route index element={<Today />} />
        <Route path="history" element={<History />} />
        <Route path="patterns" element={<Patterns />} />
        <Route path="periods" element={<Periods />} />
        <Route path="periods/new" element={<PeriodForm />} />
        <Route path="periods/:id" element={<PeriodForm />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/calendars" element={<Calendars />} />
        <Route path="*" element={<Today />} />
      </Route>
    </Routes>
  );
}

export function App() {
  if (!isConfigured) return <SetupNeeded />;
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
