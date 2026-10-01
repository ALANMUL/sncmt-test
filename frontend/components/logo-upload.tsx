'use client';
import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { uploadImage } from '@/lib/api';

export function ImageUpload({
  label,
  value,
  onChange,
  round,
}: {
  label: string;
  value?: string;
  onChange: (url: string) => void;
  round?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      onChange(await uploadImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border border-dashed border-line bg-white text-ink/50 hover:bg-paper ${round ? 'rounded-full' : 'rounded-md'}`}
          aria-label={label}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={22} />}
        </button>
        <span className="text-xs text-ink/60">{busy ? 'Uploading…' : value ? 'Click the picture to change it' : 'PNG or JPG, up to 2 MB'}</span>
      </div>
      {error && <span className="block text-xs text-flag">{error}</span>}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={pick} />
    </div>
  );
}
