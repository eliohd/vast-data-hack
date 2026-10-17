import { useEffect, useState } from 'react';

/** Matches the phone-only layout breakpoint in street-navigation.css (`max-width: 900px`). */
export const PHONE_QUERY = '(max-width: 900px)';

/** True while the full-screen phone layout is showing (the desktop side panels are hidden). */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}
