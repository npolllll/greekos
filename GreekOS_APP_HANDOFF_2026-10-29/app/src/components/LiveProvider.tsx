'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';

type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
interface LiveCtx { status: LiveStatus; unseen: number; lastEventAt: string | null; markSeen: () => void }

const Ctx = createContext<LiveCtx>({ status: 'connecting', unseen: 0, lastEventAt: null, markSeen: () => undefined });
export const useLive = () => useContext(Ctx);

/**
 * Subscribes to confirmed server-side learning events (RLS-filtered Realtime). Screens never
 * animate fake numbers: on each event or reconnect the server snapshot is re-fetched.
 */
export function LiveProvider({ userId, isOwner, children }: { userId: string; isOwner: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [unseen, setUnseen] = useState(0);
  const [lastEventAt, setLast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasDown = useRef(false);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 350);
    };
    const supabase = browserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`learner-events-${userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'learner_events', ...(isOwner ? {} : { filter: `user_id=eq.${userId}` }) }, (payload) => {
          const row = payload.new as { user_id: string; occurred_at: string };
          if (row.user_id === userId) setUnseen((n) => n + 1);
          setLast(row.occurred_at);
          refresh();
        })
        .subscribe((s) => {
          if (s === 'SUBSCRIBED') {
            setStatus('live');
            if (wasDown.current) { wasDown.current = false; refresh(); }
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
            wasDown.current = true;
            setStatus(navigator.onLine ? 'reconnecting' : 'offline');
          }
        });
    })();

    const { data: authSub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });
    const onOffline = () => { wasDown.current = true; setStatus('offline'); };
    const onOnline = () => { setStatus('reconnecting'); refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, isOwner, router]);

  return <Ctx.Provider value={{ status, unseen, lastEventAt, markSeen: () => setUnseen(0) }}>{children}</Ctx.Provider>;
}
