'use client';
import { createContext, useContext } from 'react';

export interface School {
  name: string;
  subdomain: string;
  logo_url: string | null;
  banner_url: string | null;
}
const Ctx = createContext<School | null>(null);
export const SchoolProvider = ({ school, children }: { school: School | null; children: React.ReactNode }) => (
  <Ctx.Provider value={school}>{children}</Ctx.Provider>
);
export const useSchool = () => useContext(Ctx);

/** School logo, or the school's initials when it has none. */
export function SchoolMark({ school, size = 40, light }: { school: School | null; size?: number; light?: boolean }) {
  const initials = (school?.name ?? 'S').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  if (school?.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={school.logo_url} alt={`${school.name} logo`} style={{ width: size, height: size }} className="rounded-md bg-white object-contain" />;
  }
  return (
    <span style={{ width: size, height: size }} className={`flex items-center justify-center rounded-md text-sm font-semibold ${light ? 'bg-white/15 text-white' : 'bg-field text-white'}`}>
      {initials}
    </span>
  );
}
