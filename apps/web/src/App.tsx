import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { AppShell } from '@/components/layout/AppShell';
import { SettingsLayout } from '@/components/layout/SettingsLayout';
import { Login } from '@/pages/auth/Login';
import { Register } from '@/pages/auth/Register';
import { Dashboard } from '@/pages/Dashboard';
import { Events } from '@/pages/Events';
import { Subscribers } from '@/pages/Subscribers';
import { SubscriberDetail } from '@/pages/SubscriberDetail';
import { Audiences } from '@/pages/Audiences';
import { AudienceEditor } from '@/pages/AudienceEditor';
import { Templates } from '@/pages/Templates';
import { TemplateEditor } from '@/pages/TemplateEditor';
import { Broadcasts } from '@/pages/Broadcasts';
import { BroadcastEditor } from '@/pages/BroadcastEditor';
import { BroadcastDetail } from '@/pages/BroadcastDetail';
import { Journeys } from '@/pages/Journeys';
import { JourneyEditor } from '@/pages/JourneyEditor';
import { JourneyDetail } from '@/pages/JourneyDetail';
import { Deliveries } from '@/pages/Deliveries';
import { SubscriptionGroups } from '@/pages/SubscriptionGroups';
import { Suppressions } from '@/pages/Suppressions';
import { ApiTokens } from '@/pages/ApiTokens';
import { Secrets } from '@/pages/Secrets';
import { Profile } from '@/pages/Profile';
import { PreferencesCenter } from '@/pages/public/PreferencesCenter';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/p/preferences/:token" element={<PreferencesCenter />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="/events" element={<Events />} />
        <Route path="/subscribers" element={<Subscribers />} />
        <Route path="/subscribers/:externalId" element={<SubscriberDetail />} />
        <Route path="/audiences" element={<Audiences />} />
        <Route path="/audiences/new" element={<AudienceEditor />} />
        <Route path="/audiences/:id" element={<AudienceEditor />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/templates/new" element={<TemplateEditor />} />
        <Route path="/templates/:id" element={<TemplateEditor />} />
        <Route path="/broadcasts" element={<Broadcasts />} />
        <Route path="/broadcasts/new" element={<BroadcastEditor />} />
        <Route path="/broadcasts/:id" element={<BroadcastDetail />} />
        <Route path="/broadcasts/:id/edit" element={<BroadcastEditor />} />
        <Route path="/journeys" element={<Journeys />} />
        <Route path="/journeys/new" element={<JourneyEditor />} />
        <Route path="/journeys/:id" element={<JourneyDetail />} />
        <Route path="/journeys/:id/edit" element={<JourneyEditor />} />
        <Route path="/deliveries" element={<Deliveries />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<Profile />} />
          <Route path="subscription-groups" element={<SubscriptionGroups />} />
          <Route path="suppressions" element={<Suppressions />} />
          <Route path="api-tokens" element={<ApiTokens />} />
          <Route path="secrets" element={<Secrets />} />
        </Route>
      </Route>
    </Routes>
  );
}
