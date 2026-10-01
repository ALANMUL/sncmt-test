import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform admin',
  SCHOOL_SUPER_ADMIN: 'Super admin',
  SCHOOL_ADMIN: 'Admin',
  ACCOUNTANT: 'Accountant',
  TEACHER: 'Teacher',
  STAFF: 'Staff',
  GUARDIAN: 'Guardian',
  STUDENT: 'Student',
};
