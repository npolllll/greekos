import { ViewTransition } from 'react';

/**
 * Route-level choreography: templates remount on every navigation, so the outgoing page fades out
 * quickly and the incoming one fades in while its panels rise in a short stagger (CSS). The rail and
 * top bar are named view-transition anchors and stay still.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <ViewTransition enter="page" exit="page" default="none">{children}</ViewTransition>;
}
