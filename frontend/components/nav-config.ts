import { LayoutDashboard, UserCircle, Users, UsersRound, type LucideIcon } from 'lucide-react';

export interface NavLeaf {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: string[] | 'ALL';
}
export interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavLeaf[];
}
export type NavEntry = NavLeaf | NavGroup;

const ADMINS = ['PLATFORM_ADMIN', 'SCHOOL_SUPER_ADMIN', 'SCHOOL_ADMIN'];

export const NAV: NavEntry[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ADMINS },
  {
    label: 'People',
    icon: UsersRound,
    children: [{ href: '/dashboard/users', label: 'Users', icon: Users, roles: ADMINS }],
  },
  { href: '/dashboard/profile', label: 'My profile', icon: UserCircle, roles: 'ALL' },
];

export const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

const allowed = (leaf: NavLeaf, roles: string[]) =>
  leaf.roles === 'ALL' || leaf.roles.some((r) => roles.includes(r));

export function navFor(roles: string[]): NavEntry[] {
  const out: NavEntry[] = [];
  for (const e of NAV) {
    if (isGroup(e)) {
      const children = e.children.filter((c) => allowed(c, roles));
      if (children.length) out.push({ ...e, children });
    } else if (allowed(e, roles)) {
      out.push(e);
    }
  }
  return out;
}

export const flatten = (entries: NavEntry[]): NavLeaf[] =>
  entries.flatMap((e) => (isGroup(e) ? e.children : [e]));

export const isActivePath = (href: string, path: string) =>
  href === '/dashboard' ? path === href : path.startsWith(href);