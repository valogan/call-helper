import { useState } from 'react';
import type { Session, SessionDraft, Settings } from './types';
import { loadSettings } from './lib/settings';
import { persistSession } from './lib/storage';
import Home from './components/Home';
import SettingsView from './components/SettingsView';
import SessionView from './components/SessionView';
import ReviewView from './components/ReviewView';

type View =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'live'; draft: SessionDraft; settings: Settings }
  | { name: 'review'; sessionId: string };

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' });

  const startSession = (draft: SessionDraft) => {
    setView({ name: 'live', draft, settings: loadSettings() });
  };

  const endSession = (session: Session) => {
    persistSession(session);
    setView({ name: 'review', sessionId: session.id });
  };

  switch (view.name) {
    case 'home':
      return (
        <Home
          onOpenSettings={() => setView({ name: 'settings' })}
          onStart={startSession}
          onOpenSession={(id) => setView({ name: 'review', sessionId: id })}
        />
      );
    case 'settings':
      return <SettingsView onBack={() => setView({ name: 'home' })} />;
    case 'live':
      return (
        <SessionView
          draft={view.draft}
          settings={view.settings}
          onEnded={endSession}
          onCancel={() => setView({ name: 'home' })}
        />
      );
    case 'review':
      return <ReviewView sessionId={view.sessionId} onBack={() => setView({ name: 'home' })} />;
  }
}
