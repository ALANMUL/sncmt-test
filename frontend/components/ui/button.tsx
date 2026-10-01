import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}
const styles: Record<Variant, string> = {
  primary: 'bg-field text-white hover:bg-fieldDark',
  outline: 'border border-line bg-white text-ink hover:bg-paper',
  ghost: 'text-ink hover:bg-black/5',
  danger: 'border border-flag/40 bg-white text-flag hover:bg-flag/5',
};

export const Button = React.forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = 'primary', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
